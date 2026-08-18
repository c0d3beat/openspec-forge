# Test Cases: <work order title>

QA (functional / UAT) test cases for this work order — human-executed acceptance.
Unit and integration tests are the build's responsibility and are enforced by the
SonarQube quality gate; these cases are what the **QA team** runs to accept the story.

> QA fills in each **Result** during execution. Failing cases are filed as JIRA issues
> via `forge sync jira qa` — a workflow separate from the build Story.

### TC-1: <title>
- **Requirement:** <Requirement: name from the spec delta>
- **Scenario:** <the `#### Scenario:` this case exercises>
- **Type:** functional        <!-- functional | negative | uat | regression -->
- **Priority:** high          <!-- high | medium | low -->
- **Control:** n/a            <!-- e.g. PDP-CONSENT if this case verifies a compliance control -->
- **Preconditions:** <state the system/user must be in before the test>
- **Steps:**
  1. <action>
  2. <action>
- **Test Data:** <accounts, inputs, fixtures>
- **Expected Result:** <the observable outcome the tester verifies>
- **Result:** Not Run         <!-- QA sets: Not Run | Pass | Fail -->
