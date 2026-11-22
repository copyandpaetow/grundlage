import "../../src/components/navbar";
import "./scene-world";
import "./scene-camera";
import "./editor/scene-editor";
import "./shapes/scene-cube";
import "./shapes/scene-wall";
import "./shapes/scene-ramp";
import "./wrappers/scene-group";
import "./bench/scene-bench";
import "./style.css";
import { gridCubeCountFromLocation } from "./bench/bench-grid";
import { mountFrameMeter } from "./bench/frame-meter";
import { mountBenchScene } from "./bench/frame-scenarios";

mountFrameMeter();
const gridCubeCount = gridCubeCountFromLocation();
if (gridCubeCount !== null) void mountBenchScene(gridCubeCount, 0);
