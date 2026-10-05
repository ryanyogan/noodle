import { Config } from "@remotion/cli/config";

// The frames are flat UI, so JPEG frames at a high quality keep text edges clean and the render fast.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
