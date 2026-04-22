🚦 Safe-Nav – Smart Road Safety & Alert System

📘 Overview
Safe-Nav is a web-based platform that transforms citizen-reported road issues into real-time safety insights. It helps commuters identify hazards like potholes, poor lighting, and waterlogging through an interactive map interface and supports safer route decisions.

🎯 Objectives
Improve road safety through real-time hazard visibility
Enable easy reporting of road issues
Identify high-risk zones using data clustering
Provide actionable insights for safer navigation

⚙️ Tech Stack
Frontend: HTML, CSS, JavaScript
Backend: Node.js (Express)
Database: MySQL
API: Google Maps API

📁 Project Structure
safe-nav/
│
├── backend-api/
│   ├── index.js
│   ├── package.json
│   ├── package-lock.json
│   └── .env
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
└── .gitignore

🧠 Key Features
📍 Report road hazards (potholes, waterlogging, poor lighting)
🗺️ Visualize issues on an interactive map
📊 Identify high-risk zones using clustering logic
🔔 Alerts for unsafe routes
📈 Analyze patterns of reported issues

🔍 How It Works
User reports a road issue via frontend
Data is sent to backend (Node.js API)
Stored in MySQL database
Displayed on map using Google Maps API
Clustering highlights high-risk zones

🚀 Installation & Setup
1. Clone Repository
git clone https://github.com/your-username/safe-nav.git
cd safe-nav

3. Backend Setup
cd backend-api
npm install
node index.js

⚠️ Create a .env file in the backend-api folder and add your configuration (database credentials, API keys).


3. Frontend Setup
Open frontend/index.html in browser
OR
Use Live Server in VS Code

🔑 Google Maps API Setup
To run this project, you need your own Google Maps API key:
Go to Google Cloud Console
Enable Maps JavaScript API
Create an API key
Replace in frontend/index.html:
key=YOUR_API_KEY_HERE

⚠️ Do not expose your API key publicly. Always use restrictions.
🔐 Environment & Security
Sensitive data (API keys, DB credentials) is stored in .env
.env is excluded using .gitignore
Never expose secrets in public repositories

📊 Use Cases
Helping commuters avoid unsafe routes
Identifying accident-prone areas
Supporting smart city planning

⚠️ Limitations
Depends on user-reported data
Basic clustering logic
No real-time verification

🔮 Future Enhancements
AI-based risk prediction
Mobile application
Image-based verification
Advanced analytics

📜 Disclaimer
This project is for educational purposes only.
