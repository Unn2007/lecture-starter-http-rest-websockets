import { type Server, type Socket } from "socket.io";

import { texts } from "../data.js";
import { MAXIMUM_USERS_FOR_ONE_ROOM, SECONDS_FOR_GAME, SECONDS_TIMER_BEFORE_START_GAME } from "./config.js";

interface CustomSocket extends Socket {
    handshake: Socket["handshake"];
}

interface Room {
    finished: Set<string>;
    gameStarted: boolean;
    progress: Map<string, number>;
    ready: Map<string, boolean>;
    textId: null | number;
    users: Map<string, { ready: boolean; username: string }>;
}

const rooms = new Map<string, Room>();
const users = new Map<string, string>();

const NONE = 0;
const ONE_SECOND_MS = 1000;

function getRooms(): Array<{ name: string; numberOfUsers: number }> {
    return [...rooms.entries()]
        .filter(([_, room]) => room.users.size <= MAXIMUM_USERS_FOR_ONE_ROOM && !room.gameStarted)
        .map(([name, room]) => ({
            name,
            numberOfUsers: room.users.size
        }));
}

const socketHandler = (io: Server): void => {
    io.on("connection", (socket: CustomSocket) => {
        const { username } = socket.handshake.query;

        if (typeof username !== "string") {
            socket.emit("username_error", { message: "Invalid username provided." });
            socket.disconnect();

            return;
        }

        if (users.has(username)) {
            socket.emit("username_error", { message: "This username is already in use." });
            socket.disconnect();

            return;
        }

        users.set(username, socket.id);

        socket.on("disconnect", () => {
            users.delete(username);
            const userRoom = [...rooms.entries()].find(([_, room]) => room.users.has(username))?.[NONE];

            if (userRoom) {
                const room = rooms.get(userRoom);

                if (room) {
                    room.users.delete(username);
                    io.to(userRoom).emit("user_left", username);

                    if (room.users.size === NONE) {
                        rooms.delete(userRoom);
                    } else {
                        checkGameStatus(userRoom);
                    }

                    io.emit("rooms", getRooms());
                }
            }
        });

        socket.emit("rooms", getRooms());

        socket.on("create_room", (roomName: string) => {
            if (rooms.has(roomName)) {
                socket.emit("room_error", "Room with this name already exists");

                return;
            }

            rooms.set(roomName, {
                finished: new Set(),
                gameStarted: false,
                progress: new Map(),
                ready: new Map(),
                textId: null,
                users: new Map()
            });
            socket.emit("room_created", roomName);
            io.emit("rooms", getRooms());
        });

        socket.on("join_room", async (roomName: string) => {
            const room = rooms.get(roomName);

            if (!room || room.users.size >= MAXIMUM_USERS_FOR_ONE_ROOM || room.gameStarted) {
                socket.emit("room_error", "Cannot join this room");

                return;
            }

            await socket.join(roomName);
            room.users.set(username, { ready: false, username });
            room.ready.set(username, false);
            room.progress.set(username, NONE);
            io.to(roomName).emit("user_joined", { ready: false, username });
            socket.emit("room_joined", {
                roomName,
                users: [...room.users.values()]
            });
            io.emit("rooms", getRooms());
        });

        socket.on("leave_room", async (roomName: string) => {
            const room = rooms.get(roomName);

            if (room) {
                await socket.leave(roomName);
                room.users.delete(username);
                room.ready.delete(username);
                room.progress.delete(username);
                room.finished.delete(username);
                io.to(roomName).emit("user_left", username);

                if (room.users.size === NONE) {
                    rooms.delete(roomName);
                } else {
                    checkGameStatus(roomName);
                }

                io.emit("rooms", getRooms());
            }
        });

        socket.on("set_ready", ({ ready, room }: { ready: boolean; room: string }) => {
            const roomData = rooms.get(room);

            if (roomData) {
                roomData.ready.set(username, ready);
                io.to(room).emit("ready_status", { ready, username });
                checkGameStatus(room);
            }
        });

        socket.on("update_room_users", (roomName: string) => {
            const room = rooms.get(roomName);

            if (room) {
                io.emit("update_room_users", {
                    numberOfUsers: room.users.size,
                    roomName
                });
            }
        });

        socket.on("update_progress", ({ progress, room }: { progress: number; room: string }) => {
            const roomData = rooms.get(room);

            if (roomData) {
                roomData.progress.set(username, progress);
                io.to(room).emit("progress", { progress, username });
            }
        });

        socket.on("user_finished", (room: string) => {
            const roomData = rooms.get(room);

            if (roomData) {
                roomData.finished.add(username);
                checkGameStatus(room);
            }
        });

        socket.on("reset_ready", (room: string) => {
            const roomData = rooms.get(room);

            if (roomData) {
                for (const user of roomData.ready.keys()) {
                    roomData.ready.set(user, false);
                }

                for (const user of roomData.progress.keys()) {
                    roomData.progress.set(user, NONE);
                }

                roomData.finished.clear();
                roomData.gameStarted = false;
                io.to(room).emit("ready_status", { ready: false, username });
            }
        });
    });

    function checkGameStatus(roomName: string): void {
        const room = rooms.get(roomName);

        if (!room) {
            return;
        }

        const allReady = room.users.size > NONE && [...room.ready.values()].every(Boolean);

        if (allReady && !room.gameStarted) {
            room.gameStarted = true;
            // eslint-disable-next-line sonarjs/pseudo-random
            room.textId = Math.floor(Math.random() * texts.length);
            let seconds = SECONDS_TIMER_BEFORE_START_GAME;
            io.to(roomName).emit("start_timer", seconds);
            const timer = setInterval(() => {
                seconds--;

                if (seconds >= NONE) {
                    io.to(roomName).emit("update_timer", seconds);
                } else {
                    clearInterval(timer);
                    io.to(roomName).emit("start_game", room.textId);
                    startGameTimer(roomName);
                }
            }, ONE_SECOND_MS);
        }

        if (room.gameStarted && room.finished.size === room.users.size) {
            endGame(roomName);
        }
    }

    function startGameTimer(roomName: string): void {
        let seconds = SECONDS_FOR_GAME;
        io.to(roomName).emit("update_game_timer", seconds);
        const timer = setInterval(() => {
            seconds--;

            if (seconds >= NONE) {
                io.to(roomName).emit("update_game_timer", seconds);
            } else {
                clearInterval(timer);
                endGame(roomName);
            }
        }, ONE_SECOND_MS);
    }

    function endGame(roomName: string): void {
        const room = rooms.get(roomName);

        if (!room) {
            return;
        }

        const usersFinished = [...room.finished].filter((user) => room.users.has(user));
        io.to(roomName).emit("game_ended", { users: usersFinished });
        room.gameStarted = false;
    }
};

export { socketHandler };
