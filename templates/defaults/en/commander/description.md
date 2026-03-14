# Commander Template
A template for high-level decision-making and managing multiple subordinate agents.

## Contents
- `docs/fleet.json`: Definition of subordinate agents (Workers).
- `AGENT.MD`: Rules for commander behavior and coordination between user and Workers.

## Agent Workflow
1. Interpret user intent and decompose tasks.
2. Issue instructions to appropriate Worker agents and oversee their progress.
3. Provide solutions when a Worker seeks help or gets stuck.
4. Consult the user directly for critical decisions.
