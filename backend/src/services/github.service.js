const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const axios = require('axios');
const prisma = require('../utils/prisma');

// ─── Passport GitHub Strategy ─────────────────────────────────────────────────
passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL,
      scope: ['read:user', 'user:email', 'repo'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const githubId = profile.id.toString();

        // Check if GitHub account already exists
        let githubAccount = await prisma.githubAccount.findUnique({
          where: { githubId },
          include: { user: true },
        });

        let user;
        if (githubAccount) {
          // Update existing account with fresh token
          await prisma.githubAccount.update({
            where: { githubId },
            data: { accessToken, login: profile.username },
          });
          // Update user info
          user = await prisma.user.update({
            where: { id: githubAccount.userId },
            data: {
              name: profile.displayName || profile.username,
              avatarUrl: profile.photos?.[0]?.value,
              ...(email && { email }),
            },
          });
        } else {
          // Create new user + github account
          user = await prisma.user.create({
            data: {
              email: email || null,
              name: profile.displayName || profile.username,
              avatarUrl: profile.photos?.[0]?.value,
              githubAccount: {
                create: {
                  githubId,
                  login: profile.username,
                  accessToken,
                },
              },
            },
          });
        }

        // Reload with relations for serialization
        user = await prisma.user.findUnique({
          where: { id: user.id },
          include: { githubAccount: true },
        });

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { githubAccount: true },
    });
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// ─── GitHub API Helper ────────────────────────────────────────────────────────

/**
 * Create an axios instance pre-configured with a GitHub access token.
 */
const createGitHubClient = (accessToken) => {
  return axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
};

/**
 * Fetch all repositories for the authenticated user (owned + collaborator).
 */
const getUserRepositories = async (accessToken) => {
  const client = createGitHubClient(accessToken);
  let repos = [];
  let page = 1;

  while (true) {
    const response = await client.get('/user/repos', {
      params: { per_page: 100, page, sort: 'updated' },
    });
    if (response.data.length === 0) break;
    repos = repos.concat(response.data);
    if (response.data.length < 100) break;
    page++;
  }

  return repos;
};

/**
 * Get the latest commit SHA on the default branch.
 */
const getLatestCommitSha = async (accessToken, owner, repo, branch) => {
  const client = createGitHubClient(accessToken);
  const response = await client.get(`/repos/${owner}/${repo}/commits/${branch}`);
  return response.data.sha;
};

/**
 * Get the full file tree of a repository.
 */
const getRepositoryTree = async (accessToken, owner, repo, sha) => {
  const client = createGitHubClient(accessToken);
  const response = await client.get(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  return response.data.tree;
};

/**
 * Get the raw content of a file. Returns the decoded text.
 */
const getFileContent = async (accessToken, owner, repo, path, ref) => {
  const client = createGitHubClient(accessToken);
  const response = await client.get(`/repos/${owner}/${repo}/contents/${path}`, {
    params: { ref },
  });
  const content = response.data.content;
  return Buffer.from(content, 'base64').toString('utf-8');
};

/**
 * Compare two commits and return detailed changed file info.
 * Uses GitHub Compare API: GET /repos/{owner}/{repo}/compare/{base}...{head}
 *
 * Returns array of { filename, status, sha } where status is:
 *   "added" | "modified" | "removed" | "renamed" | "copied"
 */
const getCommitDiff = async (accessToken, owner, repo, baseSha, headSha) => {
  const client = createGitHubClient(accessToken);
  const response = await client.get(`/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`);
  return response.data.files.map((f) => ({
    filename: f.filename,
    status: f.status,     // "added" | "modified" | "removed" | "renamed" | "copied"
    sha: f.sha || null,
    previousFilename: f.previous_filename || null,  // for renames
  }));
};

module.exports = {
  getUserRepositories,
  getLatestCommitSha,
  getRepositoryTree,
  getFileContent,
  getCommitDiff,
};
