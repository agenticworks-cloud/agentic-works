'use strict';
// A GannetTree over fake accounts, shared by the row and sidebar tests: co-sahn (gh, in co-e) and seanahn (VS Code);
// seanahn/perch checked out on disk with src/ and a.txt; co-sahn/notes's files refused as signed out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMemento } = require('./stubs.js');
const { GitHubError } = require('../src/github.js');
const { createRecent } = require('../src/recent.js');
const { createLocalRepos } = require('../src/localRepos.js');
const { createRepoCache } = require('../src/repoCache.js');
const { createWorkspaces } = require('../src/workspaces.js');
const { GannetTree } = require('../src/tree.js');

const R = (fullName, extra = {}) => ({ fullName, owner: fullName.split('/')[0], name: fullName.split('/')[1], private: false, archived: false, defaultBranch: 'main', htmlUrl: 'https://github.com/' + fullName, cloneUrl: `https://github.com/${fullName}.git`, ...extra });

async function makeTreeFixture(vscode) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gannet-fx-'));
  const home = path.join(tmp, 'home');
  const perch = path.join(home, 'github', 'perch');
  fs.mkdirSync(path.join(perch, 'src'), { recursive: true });
  fs.writeFileSync(path.join(perch, 'a.txt'), 'a');
  const lists = {
    'co-sahn': { orgs: ['co-e'], pushed: [R('co-e/hub'), R('co-sahn/notes')], all: [R('co-e/hub'), R('co-sahn/notes')] },
    seanahn: { orgs: [], pushed: [R('seanahn/perch'), R('seanahn/rookery')], all: [R('seanahn/perch'), R('seanahn/rookery')] },
  };
  const clientFor = (login) => ({
    listOrgs: async () => lists[login].orgs,
    listRepos: async ({ sort }) => (sort === 'pushed' ? lists[login].pushed : lists[login].all),
    listDir: async (owner, repo) => {
      if (`${owner}/${repo}` === 'co-sahn/notes') throw new GitHubError('auth', 401, 'Bad credentials');
      return { entries: [], truncated: false };
    },
  });
  const accounts = { list: async () => [{ login: 'co-sahn', source: 'gh' }, { login: 'seanahn', source: 'vscode' }], forget() {} };
  const local = createLocalRepos({ memento: makeMemento(), home });
  await local.remember('seanahn/perch', { path: perch, login: 'seanahn', byGannet: true });
  const workspaces = createWorkspaces({ memento: makeMemento(), home });
  await workspaces.add(path.join(home, 'github'));
  const tree = new GannetTree({ vscode, accounts, clientFor, recent: createRecent(makeMemento()), local, cache: createRepoCache(path.join(tmp, 'store')), workspaces, home });
  return { tree, tmp, home, perch, workspaces, local, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

module.exports = { makeTreeFixture, R };
