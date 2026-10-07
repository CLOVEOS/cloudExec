const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const config = require("./config");
const { col } = require("./db");
const { UI_LANGUAGES } = require("./sarvam");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sign(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function publicUser(u) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    role: u.role,
    preferredLanguage: u.preferredLanguage || "en-IN",
    college: u.college || "",
    goal: u.goal || "",
    createdAt: u.createdAt,
  };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, role: payload.role, name: payload.name };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

router.post("/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const name = String(req.body.name || "").trim().slice(0, 80);
  const password = String(req.body.password || "");
  const preferredLanguage = UI_LANGUAGES[req.body.preferredLanguage] ? req.body.preferredLanguage : "en-IN";

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Valid email required" });
  if (!name) return res.status(400).json({ error: "Name required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const users = await col("users");
  const user = {
    email,
    name,
    passwordHash: await bcrypt.hash(password, 10),
    role: config.adminEmails.includes(email) ? "admin" : "user",
    preferredLanguage,
    college: String(req.body.college || "").slice(0, 120),
    goal: String(req.body.goal || "").slice(0, 200),
    createdAt: new Date(),
  };
  try {
    const { insertedId } = await users.insertOne(user);
    user._id = insertedId;
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Email already registered" });
    throw e;
  }
  res.status(201).json({ token: sign(user), user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await (await col("users")).findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await (await col("users")).findOne({ _id: new ObjectId(req.user.id) });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

router.patch("/me", requireAuth, async (req, res) => {
  const update = {};
  if (typeof req.body.name === "string" && req.body.name.trim()) update.name = req.body.name.trim().slice(0, 80);
  if (UI_LANGUAGES[req.body.preferredLanguage]) update.preferredLanguage = req.body.preferredLanguage;
  if (typeof req.body.college === "string") update.college = req.body.college.slice(0, 120);
  if (typeof req.body.goal === "string") update.goal = req.body.goal.slice(0, 200);

  const users = await col("users");
  const user = await users.findOneAndUpdate(
    { _id: new ObjectId(req.user.id) },
    { $set: update },
    { returnDocument: "after" }
  );
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

module.exports = { router, requireAuth, requireAdmin, publicUser };
