import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import CorridorBoard from "./CorridorBoard";
import "./board.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CorridorBoard />
  </StrictMode>,
);
