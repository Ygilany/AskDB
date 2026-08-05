function readPackage(pkg) {
  if (pkg.name === "eslint-import-resolver-typescript") {
    delete pkg.peerDependencies?.["eslint-plugin-import"];
    delete pkg.peerDependenciesMeta?.["eslint-plugin-import"];
  }
  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
