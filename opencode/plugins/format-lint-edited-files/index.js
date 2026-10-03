import postEditFormat from '../lib/post-edit-format.cjs';
import { Plugin } from '@opencode/plugin';

const { formatEditedFiles } = postEditFormat;

export default Plugin.define({
  id: 'format-lint-edited-files',
  async setup(ctx) {
    const repositoryRoot = ctx.location.project.directory || ctx.location.directory;
    await ctx.tool.hook('execute.after', async (event) => {
      formatEditedFiles({ tool: event.tool, args: event.input }, repositoryRoot);
    });
  },
});
