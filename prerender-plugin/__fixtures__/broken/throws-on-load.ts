//a module that blows up at import time: the plugin must warn and keep going
throw new Error("fixture module fails on purpose");
