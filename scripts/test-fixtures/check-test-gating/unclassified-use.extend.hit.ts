import { test } from "vitest";
const fixtures = { db: test.extend({}) }; // HIT
const { fixtureA } = test.extend({}); // HIT
