// backend-api/index.js
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors()); // if you want, restrict to your frontend origin
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---- Alerts sidecar wiring (NEW) ----
const ALERTS_URL = process.env.ALERTS_URL || "http://localhost:5001/review";

// Use global fetch if Node >= 18; otherwise lazy-load node-fetch
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

function notifyAlertsService(payload) {
  // Fire-and-forget; don't block user response
  if (!ALERTS_URL) return;
  try {
    fetchFn(ALERTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(err => console.error("Alert service post failed:", err.message));
  } catch (e) {
    console.error("Alert service call error:", e.message || e);
  }
}

// Health
app.get("/", (_req, res) => res.send("API is working 🚀"));

// Normalize DB row -> frontend shape
const toReviewDTO = (row) => ({
  id: String(row.id),
  lat: row.lat,
  lng: row.lng,
  safetyRating: row.safety_rating,
  infrastructureRating: row.infrastructure_rating,
  description: row.description,
  address: row.address,
  timestamp: row.timestamp?.toISOString?.() ?? row.timestamp
});

// GET all reviews (newest first)
app.get("/reviews", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, lat, lng, safety_rating, infrastructure_rating, description, address, timestamp
       FROM reviews
       ORDER BY timestamp DESC`
    );
    res.json(rows.map(toReviewDTO));
  } catch (err) {
    console.error("GET /reviews error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST a new review
app.post("/reviews", async (req, res) => {
  const {
    lat, lng,
    safetyRating,
    infrastructureRating,
    description,
    address,
    timestamp // optional; backend will default if missing
  } = req.body || {};

  if (
    typeof lat !== "number" || typeof lng !== "number" ||
    typeof safetyRating !== "number" || typeof infrastructureRating !== "number" ||
    typeof description !== "string"
  ) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO reviews (lat, lng, safety_rating, infrastructure_rating, description, address, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now()))
       RETURNING id, lat, lng, safety_rating, infrastructure_rating, description, address, timestamp`,
      [lat, lng, safetyRating, infrastructureRating, description, address || null, timestamp || null]
    );

    const saved = toReviewDTO(rows[0]);

    // ---- NEW: ping alerts sidecar (counts ~1km tiles; emails when > threshold) ----
    // Safe payload: do not expose auth details; this is a one-way notify.
    notifyAlertsService({
      lat: saved.lat,
      lng: saved.lng,
      location: saved.address,          // optional; alerts service will use lat/lng to bucket
      description: saved.description || ""
    });

    res.status(201).json(saved);
  } catch (err) {
    console.error("POST /reviews error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE a review
app.delete("/reviews/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM reviews WHERE id = $1`, [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /reviews/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
