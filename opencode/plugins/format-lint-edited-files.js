import postEditFormat from './lib/post-edit-format.cjs';

const { formatEditedFiles } = postEditFormat;

export default async function formatLintEditedFilesPlugin({ directory, worktree }) {
  const repositoryRoot = worktree || directory || process.cwd();
  return {
    'tool.execute.after': async (input) => {
      formatEditedFiles(input, repositoryRoot);
    },
  };
}
