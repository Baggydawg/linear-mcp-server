/**
 * Quick verification script to compare team.members() vs client.users() API responses.
 * Run with: bun run scripts/verify-team-members-api.ts
 *
 * This confirms that team.members() returns User objects with the same fields
 * we need for the team-scoping implementation.
 */

import { LinearClient } from '@linear/sdk';

// Bun automatically loads .env files

const REQUIRED_FIELDS = ['id', 'name', 'displayName', 'email', 'active', 'createdAt'];
const OPTIONAL_FIELDS = ['admin', 'guest'];

async function main() {
  const apiKey = process.env.LINEAR_ACCESS_TOKEN || process.env.PROVIDER_API_KEY;

  if (!apiKey) {
    console.error(
      'ERROR: No API key found. Set LINEAR_ACCESS_TOKEN or PROVIDER_API_KEY in .env',
    );
    process.exit(1);
  }

  const client = new LinearClient({ apiKey });

  console.log('='.repeat(70));
  console.log('LINEAR API VERIFICATION: team.members() vs client.users()');
  console.log('='.repeat(70));

  // 1. Fetch workspace users via client.users()
  console.log('\n1. Fetching users via client.users({ first: 5 })...\n');
  const usersConn = await client.users({ first: 5 });
  const workspaceUser = usersConn.nodes[0];

  if (!workspaceUser) {
    console.error('ERROR: No users found in workspace');
    process.exit(1);
  }

  console.log('Sample user from client.users():');
  console.log(JSON.stringify(workspaceUser, null, 2));

  // 2. Find a team (prefer SQT if exists)
  console.log('\n2. Finding team (preferring SQT)...\n');
  const teamsConn = await client.teams({ first: 10 });
  const team = teamsConn.nodes.find((t) => t.key === 'SQT') || teamsConn.nodes[0];

  if (!team) {
    console.error('ERROR: No teams found');
    process.exit(1);
  }

  console.log(`Using team: ${team.name} (${team.key})`);

  // 3. Fetch team members via team.members()
  console.log('\n3. Fetching members via team.members({ first: 5 })...\n');
  const membersConn = await team.members({ first: 5 });
  const teamMember = membersConn.nodes[0];

  if (!teamMember) {
    console.error('ERROR: No members found in team');
    process.exit(1);
  }

  console.log('Sample member from team.members():');
  console.log(JSON.stringify(teamMember, null, 2));

  // 4. Compare fields
  console.log('\n' + '='.repeat(70));
  console.log('FIELD COMPARISON');
  console.log('='.repeat(70));

  const workspaceUserKeys = Object.keys(workspaceUser);
  const teamMemberKeys = Object.keys(teamMember);

  console.log(
    `\nclient.users() fields (${workspaceUserKeys.length}): ${workspaceUserKeys.sort().join(', ')}`,
  );
  console.log(
    `\nteam.members() fields (${teamMemberKeys.length}): ${teamMemberKeys.sort().join(', ')}`,
  );

  // 5. Check required fields
  console.log('\n' + '='.repeat(70));
  console.log('REQUIRED FIELDS CHECK');
  console.log('='.repeat(70));

  let allRequiredPresent = true;
  for (const field of REQUIRED_FIELDS) {
    const inUsers = field in workspaceUser;
    const inMembers = field in teamMember;
    const status = inMembers ? '✅' : '❌';
    console.log(
      `${status} ${field.padEnd(15)} | client.users(): ${inUsers ? 'YES' : 'NO'} | team.members(): ${inMembers ? 'YES' : 'NO'}`,
    );
    if (!inMembers) allRequiredPresent = false;
  }

  console.log('\n' + '='.repeat(70));
  console.log('OPTIONAL FIELDS CHECK');
  console.log('='.repeat(70));

  for (const field of OPTIONAL_FIELDS) {
    const inUsers = field in workspaceUser;
    const inMembers = field in teamMember;
    const status = inMembers ? '✅' : '⚠️';
    console.log(
      `${status} ${field.padEnd(15)} | client.users(): ${inUsers ? 'YES' : 'NO'} | team.members(): ${inMembers ? 'YES' : 'NO'}`,
    );
  }

  // 6. Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  if (allRequiredPresent) {
    console.log('\n✅ SUCCESS: team.members() returns all required fields.');
    console.log('   The team-scoping implementation can proceed safely.\n');
  } else {
    console.log('\n❌ FAILURE: team.members() is missing required fields.');
    console.log('   The plan needs adjustment before implementation.\n');
  }

  // 7. Show member count
  console.log(
    `Team "${team.name}" has ${membersConn.nodes.length} members (fetched up to 5)`,
  );
  console.log('Member names:', membersConn.nodes.map((m) => m.name).join(', '));
}

main().catch(console.error);
