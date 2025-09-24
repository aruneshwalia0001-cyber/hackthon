// client.js
(() => {
  const socket = io();

  // UI refs
  const joinStudentBtn = document.getElementById("joinStudentBtn");
  const joinTeacherBtn = document.getElementById("joinTeacherBtn");
  const nameInput = document.getElementById("nameInput");
  const teacherPass = document.getElementById("teacherPass");
  const loginMsg = document.getElementById("loginMsg");
  const roleDisplay = document.getElementById("roleDisplay");
  const teacherCountEl = document.getElementById("teacherCount");
  const studentCountEl = document.getElementById("studentCount");

  const messagesEl = document.getElementById("messages");
  const textInput = document.getElementById("textInput");
  const fileInput = document.getElementById("fileInput");
  const sendBtn = document.getElementById("sendBtn");

  const uploadForm = document.getElementById("uploadForm");
  const fileInputSidebar = document.getElementById("fileInputSidebar");
  const uploaderName = document.getElementById("uploaderName");
  const recordBtn = document.getElementById("recordBtn");

  // local identity
  let studentId = localStorage.getItem("studentId");
  if (!studentId) {
    studentId = "stu-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("studentId", studentId);
  }
  let anonName = localStorage.getItem("anonName") || `Anon-${studentId.slice(-4)}`;
  let role = null; // 'student' or 'teacher'
  let currentUser = "Anonymous";

  // Helpers
  function log(...args) { console.log("[client]", ...args); }
  function el(tag, cls) { const d = document.createElement(tag); if (cls) d.className = cls; return d; }

  // Render a single message (public message object)
  function renderMessage(msg) {
    const wrapper = el("div", "msg");
    wrapper.dataset.id = msg.id;

    const meta = el("div", "meta");
    meta.innerText = `${msg.anonName || msg.user} • ${new Date(msg.createdAt || Date.now()).toLocaleTimeString()} • ${msg.role || ""}`;
    wrapper.appendChild(meta);

    const body = el("div", "body");
    body.innerHTML = msg.text ? escapeHtml(msg.text) : "";
    wrapper.appendChild(body);

    // file preview
    if (msg.fileUrl) {
      const ft = (msg.fileType || "").toLowerCase();
      if (ft.startsWith("image/")) {
        const img = el("img");
        img.src = msg.fileUrl;
        wrapper.appendChild(img);
      } else if (ft.startsWith("video/")) {
        const v = el("video");
        v.controls = true;
        v.src = msg.fileUrl;
        wrapper.appendChild(v);
      } else if (ft.startsWith("audio/")) {
        const a = el("audio");
        a.controls = true;
        a.src = msg.fileUrl;
        wrapper.appendChild(a);
      } else {
        const a = el("a");
        a.href = msg.fileUrl;
        a.innerText = `📎 ${msg.fileUrl.split("/").pop()}`;
        a.target = "_blank";
        wrapper.appendChild(a);
      }
    }

    // vote row
    const voteRow = el("div", "voteRow");
    const upBtn = el("button"); upBtn.innerText = "👍";
    const downBtn = el("button"); downBtn.innerText = "👎";
    const upCount = el("span", "voteCount"); upCount.id = `up-${msg.id}`; upCount.innerText = msg.votes?.up ?? 0;
    const downCount = el("span", "voteCount"); downCount.id = `down-${msg.id}`; downCount.innerText = msg.votes?.down ?? 0;

    upBtn.onclick = () => {
      socket.emit("vote", { messageId: msg.id, type: "up", voterId: studentId || (`teacher:${socket.id}`) });
    };
    downBtn.onclick = () => {
      socket.emit("vote", { messageId: msg.id, type: "down", voterId: studentId || (`teacher:${socket.id}`) });
    };

    voteRow.appendChild(upBtn);
    voteRow.appendChild(upCount);
    voteRow.appendChild(downBtn);
    voteRow.appendChild(downCount);
    wrapper.appendChild(voteRow);

    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(s) {
    if (!s) return "";
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // join as student
  joinStudentBtn.addEventListener("click", () => {
    anonName = nameInput.value.trim() || anonName;
    localStorage.setItem("anonName", anonName);
    socket.emit("join", { role: "student", name: anonName, studentId });
  });

  // join as teacher
  joinTeacherBtn.addEventListener("click", () => {
    const pw = teacherPass.value || "";
    socket.emit("join", { role: "teacher", password: pw });
  });

  // receiving join result
  socket.on("joinResult", (data) => {
    if (!data || data.success !== true) {
      loginMsg.innerText = data?.error || "Join failed";
      loginMsg.style.color = "tomato";
      return;
    }
    role = data.role;
    currentUser = role === "teacher" ? "Teacher" : (data.anonName || anonName);
    roleDisplay.innerText = `${currentUser} (${role})`;
    loginMsg.innerText = `Joined as ${role}`;
    loginMsg.style.color = "lightgreen";
    log("Joined successfully:", data);

    // show/hide relevant UI
    document.getElementById("loginArea").style.display = "none";
  });

  // initial messages
  socket.on("initialMessages", (msgs) => {
    messagesEl.innerHTML = "";
    (msgs || []).forEach(renderMessage);
  });

  // admin-specific initial (optional)
  socket.on("initialMessagesAdmin", (msgs) => {
    // teachers could inspect studentId etc. (not rendered here)
    console.log("Admin messages (full):", msgs);
  });

  // new message arrived
  socket.on("message", (msg) => {
    renderMessage(msg);
  });

  // message admin
  socket.on("messageAdmin", (msg) => {
    console.log("messageAdmin (teacher only):", msg);
  });

  // vote updates
  socket.on("voteUpdate", ({ messageId, votes }) => {
    const up = document.getElementById(`up-${messageId}`);
    const down = document.getElementById(`down-${messageId}`);
    if (up) up.innerText = votes.up ?? 0;
    if (down) down.innerText = votes.down ?? 0;
  });

  socket.on("voteRejected", ({ messageId, reason }) => {
    alert("You already voted on this message.");
  });

  // counts
  socket.on("updateCounts", ({ teachers, students }) => {
    teacherCountEl.innerText = teachers ?? 0;
    studentCountEl.innerText = students ?? 0;
  });

  // send message: upload file (if exists) then post
  sendBtn.addEventListener("click", async () => {
    const text = textInput.value.trim();
    const file = fileInput.files[0];

    // require text or file
    if (!text && !file) return alert("Type a message or choose a file.");

    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (json && json.fileUrl) {
          socket.emit("postMessage", { text, fileUrl: json.fileUrl, fileType: json.fileType });
        } else {
          alert("Upload failed");
        }
      } catch (err) {
        console.error("Upload error", err);
        alert("Upload failed");
      }
    } else {
      socket.emit("postMessage", { text });
    }
    textInput.value = "";
    fileInput.value = "";
  });

  // sidebar upload (different form)
  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = fileInputSidebar.files[0];
    if (!f) return alert("Choose a file to upload");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/upload", { method: "POST", body: fd });
      const json = await res.json();
      // server emits file via its postMessage logic only when user posts with postMessage
      // to show file as message immediately we can emit postMessage with returned fileUrl:
      socket.emit("postMessage", { text: "", fileUrl: json.fileUrl, fileType: json.fileType });
      fileInputSidebar.value = "";
    } catch (err) {
      console.error(err);
      alert("Upload failed");
    }
  });

  // voice recording
  let mediaRecorder = null;
  let audioChunks = [];
  recordBtn.addEventListener("click", async () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      // start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
          const blob = new Blob(audioChunks, { type: "audio/webm" });
          const fd = new FormData();
          fd.append("voice", blob, `voice-${Date.now()}.webm`);
          try {
            const res = await fetch("/upload-voice", { method: "POST", body: fd });
            const json = await res.json();
            if (json && json.fileUrl) {
              socket.emit("postMessage", { text: "", fileUrl: json.fileUrl, fileType: json.fileType });
            } else {
              alert("Voice upload failed");
            }
          } catch (err) {
            console.error(err); alert("Voice upload failed");
          }
        };
        mediaRecorder.start();
        recordBtn.innerText = "⏹ Stop Recording";
      } catch (err) {
        console.error("getUserMedia error", err);
        alert("Cannot access microphone");
      }
    } else {
      // stop
      mediaRecorder.stop();
      recordBtn.innerText = "🎤 Start Recording";
    }
  });

  // helper: if user closes tab, inform server (disconnect handled automatically)

  // quick debug helpers
  socket.on("connect", () => log("socket connect", socket.id));
  socket.on("disconnect", () => log("socket disconnect"));
  function log() { console.log("[client]", ...arguments); }
})();
