/**
 * TOON Schema Validation Script
 *
 * Pulls real data from Linear workspace and outputs it
 * to validate our TOON schema design decisions.
 */

import { LinearClient } from '@linear/sdk';

const LINEAR_API_KEY = process.env.LINEAR_ACCESS_TOKEN;

const client = new LinearClient({ apiKey: LINEAR_API_KEY });

async function main() {
  console.log('='.repeat(60));
  console.log('TOON SCHEMA VALIDATION - Real Linear Data');
  console.log('='.repeat(60));
  console.log();

  // 1. Viewer (current user)
  console.log('## VIEWER (Current User)');
  console.log('-'.repeat(40));
  const viewer = await client.viewer;
  console.log({
    id: viewer.id,
    name: viewer.name,
    displayName: viewer.displayName,
    email: viewer.email,
    active: viewer.active,
    timezone: viewer.timezone,
  });
  console.log();

  // 2. Teams
  console.log('## TEAMS');
  console.log('-'.repeat(40));
  const teamsConn = await client.teams({ first: 10 });
  const teams = teamsConn.nodes;
  for (const team of teams) {
    console.log({
      id: team.id,
      key: team.key,
      name: team.name,
      description: team.description,
      cyclesEnabled: team.cyclesEnabled,
      cycleDuration: team.cycleDuration,
      issueEstimationType: team.issueEstimationType,
    });
  }
  console.log();

  // 3. Workflow States (per team)
  console.log('## WORKFLOW STATES');
  console.log('-'.repeat(40));
  for (const team of teams) {
    console.log(`\nTeam: ${team.key} (${team.name})`);
    const states = await team.states();
    for (const state of states.nodes) {
      console.log({
        id: state.id,
        name: state.name,
        type: state.type,
        position: state.position,
      });
    }
  }
  console.log();

  // 4. Labels (per team)
  console.log('## LABELS');
  console.log('-'.repeat(40));
  for (const team of teams) {
    console.log(`\nTeam: ${team.key} (${team.name})`);
    const labels = await team.labels({ first: 50 });
    for (const label of labels.nodes) {
      const parent = await label.parent;
      console.log({
        id: label.id,
        name: label.name,
        color: label.color,
        parent: parent?.name || null,
      });
    }
  }
  console.log();

  // 5. Users
  console.log('## USERS');
  console.log('-'.repeat(40));
  const usersConn = await client.users({ first: 20 });
  for (const user of usersConn.nodes) {
    console.log({
      id: user.id,
      name: user.name,
      displayName: user.displayName,
      email: user.email,
      active: user.active,
    });
  }
  console.log();

  // 6. Projects
  console.log('## PROJECTS');
  console.log('-'.repeat(40));
  const projectsConn = await client.projects({ first: 20 });
  for (const project of projectsConn.nodes) {
    const lead = await project.lead;
    const projectTeams = await project.teams();
    console.log({
      id: project.id,
      name: project.name,
      description: project.description?.substring(0, 50),
      state: project.state,
      priority: project.priority,
      progress: project.progress,
      health: project.health,
      startDate: project.startDate,
      targetDate: project.targetDate,
      lead: lead?.name || null,
      teams: projectTeams.nodes.map(t => t.key),
    });
  }
  console.log();

  // 7. Cycles (for first team with cycles enabled)
  console.log('## CYCLES');
  console.log('-'.repeat(40));
  const teamWithCycles = teams.find(t => t.cyclesEnabled);
  if (teamWithCycles) {
    console.log(`\nTeam: ${teamWithCycles.key} (${teamWithCycles.name})`);
    const cycles = await teamWithCycles.cycles({ first: 5 });
    for (const cycle of cycles.nodes) {
      console.log({
        id: cycle.id,
        number: cycle.number,
        name: cycle.name,
        startsAt: cycle.startsAt,
        endsAt: cycle.endsAt,
        isActive: await isActiveCycle(cycle),
        progress: cycle.progress,
      });
    }
  } else {
    console.log('No team with cycles enabled');
  }
  console.log();

  // 8. Sample Issues (from current cycle)
  console.log('## SAMPLE ISSUES (Current Cycle)');
  console.log('-'.repeat(40));
  if (teamWithCycles) {
    const cycles = await teamWithCycles.cycles({ first: 5 });
    const activeCycle = cycles.nodes.find(c => {
      const now = new Date();
      const start = new Date(c.startsAt);
      const end = new Date(c.endsAt);
      return now >= start && now <= end;
    });

    if (activeCycle) {
      console.log(`\nActive Cycle: #${activeCycle.number} (${activeCycle.startsAt} to ${activeCycle.endsAt})`);
      const issues = await activeCycle.issues({ first: 10 });
      for (const issue of issues.nodes) {
        const state = await issue.state;
        const assignee = await issue.assignee;
        const project = await issue.project;
        const labels = await issue.labels();
        const parent = await issue.parent;
        const relations = await issue.relations();
        const inverseRelations = await issue.inverseRelations();

        console.log({
          identifier: issue.identifier,
          id: issue.id,
          title: issue.title,
          description: issue.description?.substring(0, 80),
          state: { name: state?.name, type: state?.type },
          assignee: assignee?.name || null,
          priority: issue.priority,
          priorityLabel: issue.priorityLabel,
          estimate: issue.estimate,
          project: project?.name || null,
          labels: labels.nodes.map(l => l.name),
          parent: parent?.identifier || null,
          dueDate: issue.dueDate,
          url: issue.url,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          startedAt: issue.startedAt,
          completedAt: issue.completedAt,
          relations: relations.nodes.map(r => ({ type: r.type, to: r.relatedIssue })),
          inverseRelations: inverseRelations.nodes.length,
        });
        console.log();
      }
    } else {
      console.log('No active cycle found');
    }
  }

  console.log('='.repeat(60));
  console.log('VALIDATION COMPLETE');
  console.log('='.repeat(60));
}

async function isActiveCycle(cycle: any): Promise<boolean> {
  const now = new Date();
  const start = new Date(cycle.startsAt);
  const end = new Date(cycle.endsAt);
  return now >= start && now <= end;
}

main().catch(console.error);
