const path = require("path");

module.exports = {
  pluginOptions: {
    "style-resources-loader": {
      preProcessor: "scss",
      patterns: [path.resolve(__dirname, "./src/design/index.scss")],
    },
  },
  /*add the path if project located in subdirectory on a domain
  eg for: mysite.io/project
  configs would be
  publicPath: "/project"
  */
  publicPath: "/",
};
