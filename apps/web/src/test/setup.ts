import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

Object.defineProperty(window, "location", {
  configurable: true,
  value: {
    ...window.location,
    origin: "http://localhost:5173",
    pathname: "/",
    assign: vi.fn(),
  },
});
