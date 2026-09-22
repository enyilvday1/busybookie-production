import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildGen45Request,
} from "../src/runway/gen45/buildGen45Request.js";

describe(
  "Busybookie Runway Gen-4.5 request",
  () => {
    it(
      "builds the locked landscape MP4 request",
      () => {
        const request =
          buildGen45Request({
            promptImage:
              "data:image/png;base64,AQID",

            promptText:
              "A gentle breeze moves through Littleleaf Valley.",

            durationSeconds:
              5,
          });

        expect(
          request,
        ).toEqual({
          model:
            "gen4.5",

          promptImage:
            "data:image/png;base64,AQID",

          promptText:
            "A gentle breeze moves through Littleleaf Valley.",

          ratio:
            "1280:720",

          duration:
            5,

          outputFormat:
            "mp4",
        });
      },
    );

    it(
      "rejects a duration below two seconds",
      () => {
        expect(() =>
          buildGen45Request({
            promptImage:
              "runway://reference",

            promptText:
              "Test prompt.",

            durationSeconds:
              1,
          }),
        ).toThrow();
      },
    );

    it(
      "rejects a duration above ten seconds",
      () => {
        expect(() =>
          buildGen45Request({
            promptImage:
              "runway://reference",

            promptText:
              "Test prompt.",

            durationSeconds:
              11,
          }),
        ).toThrow();
      },
    );

    it(
      "rejects a prompt longer than 1000 UTF-16 code units",
      () => {
        expect(() =>
          buildGen45Request({
            promptImage:
              "runway://reference",

            promptText:
              "a".repeat(
                1001,
              ),

            durationSeconds:
              5,
          }),
        ).toThrow(
          /1000 UTF-16/,
        );
      },
    );
  },
);
