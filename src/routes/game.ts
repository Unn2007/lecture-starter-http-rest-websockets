import { Router } from "express";
import path from "node:path";

import { HTML_FILES_PATH } from "../config.js";
import { texts } from "../data.js";

const router = Router();

const MIN_TEXT_ID = 0;
const NOT_FOUND_STATUS = 404;

router.get("/", (_request, response) => {
    const page = path.join(HTML_FILES_PATH, "game.html");
    response.sendFile(page);
});

router.get("/texts/:id", (request, response) => {
    const textId = Number.parseInt(request.params.id, 10);

    if (textId >= MIN_TEXT_ID && textId < texts.length) {
        response.send(texts[textId]);
    } else {
        response.status(NOT_FOUND_STATUS).send("Text not found");
    }
});

export { router };
