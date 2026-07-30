const { connectMongo, sendJson } = require("../lib/db");
const mongoose = require("mongoose");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    await connectMongo();
    const ready = mongoose.connection.readyState === 1;
    sendJson(res, 200, {
      status: ready ? "ok" : "degraded",
      db: ready,
      mongo: ready,
      uptime: process.uptime(),
    });
  } catch (error) {
    sendJson(res, 500, {
      status: "error",
      db: false,
      mongo: false,
      error: error instanceof Error ? error.message : "Health check failed",
    });
  }
};
