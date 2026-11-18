import { Plugin } from "@opencode/plugin"

// The GUI part takes its plugin ID from this server part. Without it the ID would be the npm package name, and renaming
// the package would reset the stored settings (plugin.project-tab-groups.*) and the command IDs users bind keys to.
export default Plugin.define({
  id: "project-tab-groups",
  setup() {},
})
