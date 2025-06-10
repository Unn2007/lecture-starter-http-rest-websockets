import { appendRoomElement, removeRoomElement, updateNumberOfUsersInRoom } from "./views/room.mjs";
import { appendUserElement, changeReadyStatus, setProgress, removeUserElement } from "./views/user.mjs";
import { showInputModal, showMessageModal, showResultsModal } from "./views/modal.mjs";
import { addClass, removeClass } from "./helpers/dom-helper.mjs";

const username = sessionStorage.getItem("username");

if (!username) {
    window.location.replace("/signin");
}

const socket = io("", { query: { username } });

const roomsPage = document.getElementById("rooms-page");
const gamePage = document.getElementById("game-page");
const roomsWrapper = document.getElementById("rooms-wrapper");
const usersWrapper = document.getElementById("users-wrapper");
const roomNameElement = document.getElementById("room-name");
const addRoomBtn = document.getElementById("add-room-btn");
const quitRoomBtn = document.getElementById("quit-room-btn");
const readyBtn = document.getElementById("ready-btn");
const timerElement = document.getElementById("timer");
const gameTimerElement = document.getElementById("game-timer");
const gameTimerSeconds = document.getElementById("game-timer-seconds");
const textContainer = document.getElementById("text-container");

let currentRoom = null;
let currentText = "";
let currentIndex = 0;
let gameStarted = false;

socket.on("username_error", (error) => {
    sessionStorage.removeItem("username");
    showMessageModal({
        message: error.message,
        onClose: () => window.location.replace("/signin")
    });
});

socket.on("connect_error", (error) => {
    sessionStorage.removeItem("username");
    showMessageModal({
        message: "Connection error: Unable to connect to the server. Please try again.",
        onClose: () => window.location.replace("/signin")
    });
});

socket.on("rooms", (rooms) => {
    roomsWrapper.innerHTML = "";
    rooms.forEach(({ name, numberOfUsers }) => {
        appendRoomElement({
            name,
            numberOfUsers,
            onJoin: () => socket.emit("join_room", name)
        });
    });
});

socket.on("room_joined", ({ roomName, users }) => {
    currentRoom = roomName;
    roomNameElement.innerText = roomName;
    usersWrapper.innerHTML = "";
    users.forEach(({ username, ready }) => {
        appendUserElement({
            username,
            ready,
            isCurrentUser: username === sessionStorage.getItem("username")
        });
    });
    addClass(roomsPage, "display-none");
    removeClass(gamePage, "display-none");
});

socket.on("room_created", (roomName) => {
    socket.emit("join_room", roomName);
});

socket.on("room_error", (message) => {
    showMessageModal({ message });
});

socket.on("user_joined", ({ username, ready }) => {
    appendUserElement({
        username,
        ready,
        isCurrentUser: username === sessionStorage.getItem("username")
    });
    socket.emit("update_room_users", currentRoom);
});

socket.on("user_left", (username) => {
    removeUserElement(username);
    socket.emit("update_room_users", currentRoom);
});

socket.on("update_room_users", ({ roomName, numberOfUsers }) => {
    updateNumberOfUsersInRoom({ name: roomName, numberOfUsers });
});

socket.on("ready_status", ({ username, ready }) => {
    changeReadyStatus({ username, ready });
});

socket.on("start_timer", (seconds) => {
    addClass(quitRoomBtn, "display-none");
    addClass(readyBtn, "display-none");
    removeClass(timerElement, "display-none");
    timerElement.innerText = seconds;
});

socket.on("update_timer", (seconds) => {
    timerElement.innerText = seconds;
});

socket.on("start_game", async (textId) => {
    addClass(timerElement, "display-none");
    removeClass(textContainer, "display-none");
    removeClass(gameTimerElement, "display-none");
    gameStarted = true;

    const response = await fetch(`/game/texts/${textId}`);
    currentText = await response.text();
    if (!currentText) {
        console.error("Failed to load text");
        return;
    }
    currentIndex = 0;
    renderText();

    document.addEventListener("keydown", handleKeyPress);
});

socket.on("update_game_timer", (seconds) => {
    gameTimerSeconds.innerText = seconds;
});

socket.on("progress", ({ username, progress }) => {
    setProgress({ username, progress });
});

socket.on("game_ended", ({ users }) => {
    gameStarted = false;
    document.removeEventListener("keydown", handleKeyPress);
    addClass(gameTimerElement, "display-none");
    showResultsModal({
        usersSortedArray: users,
        onClose: () => {
            removeClass(quitRoomBtn, "display-none");
            removeClass(readyBtn, "display-none");
            textContainer.innerHTML = "";
            currentIndex = 0;
            socket.emit("reset_ready", currentRoom);
        }
    });
});

addRoomBtn.addEventListener("click", () => {
    showInputModal({
        title: "Enter Room Name",
        onSubmit: () => {},
        onChange: (value) => {
            socket.emit("create_room", value);
        }
    });
});

quitRoomBtn.addEventListener("click", () => {
    socket.emit("leave_room", currentRoom);
    currentRoom = null;
    addClass(gamePage, "display-none");
    removeClass(roomsPage, "display-none");
});

readyBtn.addEventListener("click", () => {
    const isReady = readyBtn.innerText === "READY";
    readyBtn.innerText = isReady ? "NOT READY" : "READY";
    socket.emit("set_ready", { room: currentRoom, ready: isReady });
});

function renderText() {
    textContainer.innerHTML = "";
    currentText.split("").forEach((char, index) => {
        const span = document.createElement("span");
        span.innerText = char;
        if (index < currentIndex) {
            span.classList.add("correct");
        } else if (index === currentIndex) {
            span.classList.add("current");
        }
        textContainer.appendChild(span);
    });
}

function handleKeyPress(event) {
    if (!gameStarted) return;

    const char = event.key;
    if (char === currentText[currentIndex]) {
        currentIndex++;
        const progress = (currentIndex / currentText.length) * 100;
        socket.emit("update_progress", { room: currentRoom, progress });
        renderText();
        if (currentIndex === currentText.length) {
            socket.emit("user_finished", currentRoom);
        }
    }
}
