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

// Leaderboard endpoint
app.get("/api/leaderboard", async (req, res) => {
  try {
    // Get registered users
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, full_name, points, exp, display_id")
      .order("exp", { ascending: false });

    if (usersError) throw usersError;

    // Get temporary users
    const { data: tempUsers, error: tempError } = await supabase
      .from("temporary_leaderboard")
      .select("name, exp_points, display_id, class")
      .order("exp_points", { ascending: false });

    if (tempError) throw tempError;

    // Format registered users
    const formattedUsers = users.map((user) => ({
      id: user.id,
      name: user.full_name,
      points: user.points || 0,
      exp: user.exp || 0,
      display_id: user.display_id,
      source: "user",
    }));

    // Format temporary users
    const formattedTempUsers = tempUsers.map((user) => ({
      name: user.name,
      points: 0,
      exp: user.exp_points || 0,
      display_id: user.display_id,
      class: user.class,
      source: "temporary",
    }));

    // Combine and sort by exp
    const combined = [...formattedUsers, ...formattedTempUsers].sort(
      (a, b) => b.exp - a.exp
    );

    res.json({
      success: true,
      data: combined,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch leaderboard data",
    });
  }
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
