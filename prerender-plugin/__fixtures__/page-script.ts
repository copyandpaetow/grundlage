//the test pages' module script: what it imports is loaded on the server, its own body never runs
import "./components";

(globalThis as { pageScriptBodyRan?: boolean }).pageScriptBodyRan = true;
