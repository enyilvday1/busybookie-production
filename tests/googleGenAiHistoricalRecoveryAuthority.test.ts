import {
  describe,
  expect,
  it,
} from "vitest";

import {
  consumeFreshEpisodeOperatorSession,
  createEpisodeInvocation,
  createFreshEpisodeOperatorSession,
  episodeInvocationRecoveryAuthority,
} from "../src/execution/episodeExecutionGuard.js";

import {
  parseEpisodeAutomationCliArgs,
} from "../src/execution/cli/episodeAutomationCliArgs.js";

import {
  createGoogleGenAiSingleShotSecureProductionRecovery,
} from "../src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.js";

import {
  GOOGLE_GENAI_ACTIVATION_LIMITS,
  GOOGLE_GENAI_HISTORICAL_REMOTE_RECOVERY_HORIZON_MS,
} from "../src/googleGenai/googleGenAiActivationLimits.js";

describe(
  "Google GenAI historical recovery authority",
  () => {
    it(
      "keeps standard recovery at exactly the existing 24-hour horizon",
      () => {
        const recovery =
          createGoogleGenAiSingleShotSecureProductionRecovery(
            "synthetic-key",
          );

        expect(
          recovery.policy.recovery
            .automatedRemoteRecoveryHorizonMs,
        ).toBe(
          86_400_000,
        );

        expect(
          recovery.policy.recovery
            .automatedRemoteRecoveryHorizonMs,
        ).toBe(
          GOOGLE_GENAI_ACTIVATION_LIMITS
            .recovery
            .automatedRemoteRecoveryHorizonMs,
        );
      },
    );

    it(
      "selects exactly the fixed six-day historical horizon",
      () => {
        const recovery =
          createGoogleGenAiSingleShotSecureProductionRecovery(
            "synthetic-key",
            {},
            "OPERATOR_HISTORICAL",
          );

        expect(
          recovery.policy.recovery
            .automatedRemoteRecoveryHorizonMs,
        ).toBe(
          518_400_000,
        );

        expect(
          recovery.policy.recovery
            .automatedRemoteRecoveryHorizonMs,
        ).toBe(
          GOOGLE_GENAI_HISTORICAL_REMOTE_RECOVERY_HORIZON_MS,
        );

        expect(
          GOOGLE_GENAI_ACTIVATION_LIMITS
            .recovery
            .automatedRemoteRecoveryHorizonMs,
        ).toBe(
          86_400_000,
        );
      },
    );

    it(
      "rejects numeric horizon injection through factory options",
      () => {
        expect(
          () =>
            createGoogleGenAiSingleShotSecureProductionRecovery(
              "synthetic-key",
              {
                recoveryHorizonMs:
                  999_999_999,
              } as never,
            ),
        ).toThrow();
      },
    );

    it(
      "rejects unknown recovery-authority values",
      () => {
        expect(
          () =>
            createGoogleGenAiSingleShotSecureProductionRecovery(
              "synthetic-key",
              {},
              "CALLER_DEFINED" as never,
            ),
        ).toThrow();
      },
    );

    it(
      "parses a distinct historical reconciliation confirmation",
      () => {
        expect(
          parseEpisodeAutomationCliArgs([
            "--plan",
            "plan.json",
            "--confirm-historical-reconciliation",
          ]).confirmation,
        ).toBe(
          "HISTORICAL_RECONCILIATION",
        );
      },
    );

    it(
      "keeps reconciliation confirmations mutually exclusive",
      () => {
        expect(
          () =>
            parseEpisodeAutomationCliArgs([
              "--plan",
              "plan.json",
              "--confirm-reconciliation",
              "--confirm-historical-reconciliation",
            ]),
        ).toThrow(
          /mutually exclusive/i,
        );
      },
    );

    it(
      "historical operator sessions cannot satisfy standard reconciliation",
      () => {
        const session =
          createFreshEpisodeOperatorSession(
            "HISTORICAL_RECONCILIATION",
            true,
          );

        expect(
          () =>
            consumeFreshEpisodeOperatorSession(
              session,
              "RECONCILIATION",
            ),
        ).toThrow();

        expect(
          consumeFreshEpisodeOperatorSession(
            session,
            "HISTORICAL_RECONCILIATION",
          ),
        ).toBe(
          session.sessionId,
        );
      },
    );

    it(
      "historical recovery authority is restricted to zero-create invocations",
      () => {
        const invocation =
          createEpisodeInvocation(
            "EP02",
            0,
            "OPERATOR_HISTORICAL_RECONCILIATION",
          );

        expect(
          episodeInvocationRecoveryAuthority(
            invocation,
          ),
        ).toBe(
          "OPERATOR_HISTORICAL_RECONCILIATION",
        );

        expect(
          () =>
            createEpisodeInvocation(
              "EP02",
              1,
              "OPERATOR_HISTORICAL_RECONCILIATION",
            ),
        ).toThrow();
      },
    );

    it(
      "ordinary invocations remain standard reconciliation by default",
      () => {
        const invocation =
          createEpisodeInvocation(
            "EP02",
            0,
          );

        expect(
          episodeInvocationRecoveryAuthority(
            invocation,
          ),
        ).toBe(
          "STANDARD_RECONCILIATION",
        );
      },
    );
  },
);
