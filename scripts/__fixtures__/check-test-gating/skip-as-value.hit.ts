const pick = ok ? it : it.skip; // HIT
const run = test.skip; // HIT
const both = [it.concurrent.skip, test]; // HIT
