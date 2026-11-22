//what a turn of the loop does with the run it holds before stepping it. SEND and THROW step it at
//once; the others paint for it first, or hand over between the body and its update generator
export const SEND = 150;
export const THROW = 151;
//the run held is the body's, whose yield made runner.currentUpdateGenerator
export const START_UPDATE_GENERATOR = 152;
//payload is the template the run held yielded
export const PAINT = 153;
//payload is an uncaught error
export const FAIL = 154;
