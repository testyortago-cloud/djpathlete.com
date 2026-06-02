import { Config } from "@remotion/cli/config"

// Source files use ESM ".js" import specifiers (correct for the compiled dist/
// output that the production render bundles). For `npm run studio` and CLI runs
// from the TS source, teach webpack to resolve ".js" → ".ts"/".tsx" so Studio
// can bundle from source.
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    extensionAlias: {
      ".js": [".js", ".ts", ".tsx"],
    },
  },
}))
