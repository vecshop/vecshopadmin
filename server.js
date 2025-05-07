require("dotenv").config();
const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const app = express();
const port = process.env.PORT || 3000;

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "src/public")));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
});

// Health check endpoint for Vercel
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// WebSocket setup
const wss = new WebSocket.Server({
  server,
  path: "/ws",
  verifyClient: (info, cb) => {
    // Accept all connections in development
    cb(true);
  },
});

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      // Handle different message types
      // ...existing message handling code...
    } catch (error) {
      console.error("WebSocket error:", error);
      ws.send(JSON.stringify({ error: "Invalid message format" }));
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});
