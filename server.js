const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ensure uploads folder exists
const UPLOADS = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// Serve static
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});
const upload = multer({ storage });

// Simple helper
function genId() {
  return crypto.randomBytes(8).toString("hex");
}

// In-memory store (demo)
const messages = []; // { id, text, anonName, studentId, role, fileUrl, fileType, votes, answered, createdAt }
const votesRecord = {}; // { messageId: Set(voterId) }

const TEACHER_PASSWORD = "teacher123";
let teacherCount = 0;
let studentCount = 0;

// Upload endpoints
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const fileUrl = `/uploads/${req.file.filename}`;
  return res.json({ fileUrl, fileType: req.file.mimetype });
});

app.post("/upload-voice", upload.single("voice"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No voice file" });
  const fileUrl = `/uploads/${req.file.filename}`;
  return res.json({ fileUrl, fileType: req.file.mimetype });
});

// Socket.IO
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.role = null;
  socket.studentId = null;
  socket.anonName = null;

  // JOIN
  socket.on("join", (payload = {}) => {
    const role = payload.role === "teacher" ? "teacher" : "student";

    if (role === "teacher") {
      if (payload.password === TEACHER_PASSWORD) {
        socket.role = "teacher";
        socket.anonName = "Teacher";
        teacherCount++;
        socket.emit("joinResult", { success: true, role: "teacher" });
        console.log(`Socket ${socket.id} joined as TEACHER`);
      } else {
        socket.emit("joinResult", { success: false, error: "Wrong password" });
        console.log(`Socket ${socket.id} attempted teacher login (failed)`);
        return;
      }
    } else {
      socket.role = "student";
      socket.studentId =
        payload.studentId || payload.studentId === 0
          ? payload.studentId
          : `stu-${genId().slice(0, 6)}`;
      socket.anonName =
        payload.name || `Anon-${socket.studentId.slice(-4)}`;
      studentCount++;
      socket.emit("joinResult", {
        success: true,
        role: "student",
        studentId: socket.studentId,
        anonName: socket.anonName,
      });
      console.log(`Socket ${socket.id} joined as STUDENT ${socket.anonName}`);
    }

    // broadcast updated counts
    io.emit("updateCounts", { teachers: teacherCount, students: studentCount });

    // send current messages (public view)
    const publicMessages = messages.map((m) => ({
      id: m.id,
      text: m.text,
      anonName: m.anonName,
      role: m.role,
      fileUrl: m.fileUrl || null,
      fileType: m.fileType || null,
      votes: m.votes,
      answered: m.answered || false,
      createdAt: m.createdAt,
    }));
    socket.emit("initialMessages", publicMessages);

    if (socket.role === "teacher") {
      socket.emit("initialMessagesAdmin", messages);
    }
  });

  // Post message
  socket.on("postMessage", (payload = {}) => {
    if (!socket.role) {
      console.log("postMessage: socket not joined yet", socket.id);
      return;
    }

    const id = genId();
    const msg = {
      id,
      text: payload.text || "",
      anonName: socket.anonName || "Anonymous",
      studentId: socket.studentId || null,
      role: socket.role || "student",
      fileUrl: payload.fileUrl || null,
      fileType: payload.fileType || null,
      votes: { up: 0, down: 0 },
      answered: false,
      createdAt: Date.now(),
    };
    messages.push(msg);

    const publicMsg = {
      id: msg.id,
      text: msg.text,
      anonName: msg.anonName,
      role: msg.role,
      fileUrl: msg.fileUrl,
      fileType: msg.fileType,
      votes: msg.votes,
      answered: msg.answered,
      createdAt: msg.createdAt,
    };

    io.emit("message", publicMsg);

    io.sockets.sockets.forEach((s) => {
      if (s.role === "teacher") {
        s.emit("messageAdmin", msg);
      }
    });

    console.log("Message posted:", publicMsg);
  });

 // Votes
socket.on("vote", (payload = {}) => {
  const { messageId, type = "up" } = payload;
  if (!messageId) return;

  const msg = messages.find((m) => m.id === messageId);
  if (!msg) return;

  // Each socket gets a unique voterId (teachers + students)
  const voterUniqueId = socket.studentId || `sock-${socket.id}`;

  if (!votesRecord[messageId]) votesRecord[messageId] = new Set();

  if (votesRecord[messageId].has(voterUniqueId)) {
    socket.emit("voteRejected", { messageId, reason: "already voted" });
    return;
  }

  votesRecord[messageId].add(voterUniqueId);

  if (type === "down") msg.votes.down++;
  else msg.votes.up++;

  // Broadcast vote counts to everyone
  io.emit("voteUpdate", { messageId, votes: msg.votes });

  // Also send admin update
  io.sockets.sockets.forEach((s) => {
    if (s.role === "teacher") {
      s.emit("voteUpdateAdmin", {
        messageId,
        votes: msg.votes,
        voters: Array.from(votesRecord[messageId]),
      });
    }
  });

  console.log(
    `Vote recorded for ${messageId} by ${voterUniqueId} (${type})`
  );
});

  // Teacher marks answered
  socket.on("markAnswered", ({ messageId }) => {
    if (socket.role !== "teacher") {
      socket.emit("actionFailed", "not authorized");
      return;
    }
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    msg.answered = true;
    io.emit("messageUpdate", { id: msg.id, answered: true });
    console.log("Marked answered:", messageId);
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id, "role:", socket.role);
    if (socket.role === "teacher") {
      teacherCount = Math.max(0, teacherCount - 1);
    } else if (socket.role === "student") {
      studentCount = Math.max(0, studentCount - 1);
    }
    io.emit("updateCounts", { teachers: teacherCount, students: studentCount });
  });
});

// start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server listening on http://localhost:${PORT}`)
);
