import { type Server } from "socket.io";

const users = new Map();

const socketHandler = (io: Server): void => {
    io.on("connection", (socket) => {
        const { username } = socket.handshake.query;

        if (users.has(username)) {
            socket.emit("username_error", { message: "This username is already in use. Please choose another one." });
            socket.disconnect();

            return;
        }

        users.set(username, socket.id);

        socket.on("disconnect", () => {
            users.delete(username);
        });
    });
};

export { socketHandler };
