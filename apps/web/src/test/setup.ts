import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

const browserLocation = window.location;
Object.defineProperty(window, "location", {
  configurable: true,
  value: {
    origin: "http://localhost:5173",
    get pathname() { return browserLocation.pathname; },
    get search() { return browserLocation.search; },
    get hash() { return browserLocation.hash; },
    assign: vi.fn(),
  },
});
