const { withAppBuildGradle } = require('@expo/config-plugins');

// Release signing for Vakana.mg.
//
// Why a config plugin and not just an edit to android/app/build.gradle:
// `make prebuild-clean` regenerates the whole android/ tree on every
// version bump, so a hand-edit there survives exactly until the next
// release and then silently reverts to debug signing. A plugin runs as
// part of `expo prebuild`, so the signing config is re-applied every time
// the tree is rebuilt.
//
// Credentials are NOT in this repo. They live in ~/.gradle/gradle.properties
// (VAKANA_RELEASE_*), outside the tree, because a keystore plus its
// password committed alongside the code is worth exactly as much as no
// keystore at all, and this repo is a candidate for open-sourcing.
//
// Without those properties a RELEASE build fails fast with a message that
// names what is missing. It used to fall back to the debug key, which meant
// a debug-signed APK could be published by accident (issue #16), and a
// debug-signed APK cannot update an installed release one. Debug builds do
// not need the properties and keep working on a fresh clone: the check only
// fires when a release task of the app module is in the Gradle task graph.
const PROPS = [
  'VAKANA_RELEASE_STORE_FILE',
  'VAKANA_RELEASE_STORE_PASSWORD',
  'VAKANA_RELEASE_KEY_ALIAS',
  'VAKANA_RELEASE_KEY_PASSWORD',
];

const ALL_PRESENT = PROPS.map((p) => `project.hasProperty('${p}')`).join(' && ');

const SIGNING_CONFIG = `
        release {
            // Populated only when every VAKANA_RELEASE_* property is set; the
            // task-graph guard at the bottom of this file refuses a release
            // build otherwise (plugins/withReleaseSigning.js).
            if (${ALL_PRESENT}) {
                storeFile file(VAKANA_RELEASE_STORE_FILE)
                storePassword VAKANA_RELEASE_STORE_PASSWORD
                keyAlias VAKANA_RELEASE_KEY_ALIAS
                keyPassword VAKANA_RELEASE_KEY_PASSWORD
            }
        }`;

// Evaluated once the task graph is known, so `assembleDebug` / `installDebug`
// / Metro-driven runs never trip it. Any release variant task of this module
// (assemble, bundle, package, install, sign, validateSigning) does.
const RELEASE_GUARD = `
// ---- Vakana.mg release-signing guard (plugins/withReleaseSigning.js) ----
gradle.taskGraph.whenReady { graph ->
    def wantsRelease = graph.allTasks.any { t ->
        t.project == project && t.name ==~ /(assemble|bundle|package|install|sign|validateSigning)Release.*/
    }
    if (!wantsRelease) return
    def required = [${PROPS.map((p) => `'${p}'`).join(', ')}]
    def missing = required.findAll { !project.hasProperty(it) }
    if (missing.isEmpty()) {
        def store = file(project.property('VAKANA_RELEASE_STORE_FILE'))
        if (!store.exists()) {
            throw new GradleException(
                "Vakana.mg release signing: keystore not found at \${store}.\\n" +
                "Fix VAKANA_RELEASE_STORE_FILE in ~/.gradle/gradle.properties.")
        }
        return
    }
    throw new GradleException(
        "Vakana.mg release signing: missing Gradle properties: \${missing.join(', ')}.\\n" +
        "Set them in ~/.gradle/gradle.properties (never in the repo). A release build\\n" +
        "no longer falls back to the debug keystore. For a local sideload build use\\n" +
        "'make apk-debug' (./gradlew assembleDebug) instead.")
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;

    // Idempotent: prebuild may run the mod more than once.
    if (src.includes('VAKANA_RELEASE_STORE_FILE')) {
      return cfg;
    }

    // 1. Declare the release signingConfig alongside the stock debug one.
    const beforeSigning = src;
    src = src.replace(/(signingConfigs\s*\{)/, `$1${SIGNING_CONFIG}`);
    if (src === beforeSigning) {
      throw new Error(
        'withReleaseSigning: could not find a `signingConfigs {` block in ' +
          'app/build.gradle. The Expo template changed. Update this plugin. ' +
          'Do not leave release builds debug-signed.'
      );
    }

    // 2. Point the release build type at it unconditionally: there is no
    //    debug fallback any more. The lazy match walks from `buildTypes {`
    //    through `release {` to the FIRST `signingConfig signingConfigs.debug`
    //    after it, so the debug build type (which legitimately uses the debug
    //    key, and appears first) is left alone.
    const beforeType = src;
    src = src.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release'
    );
    if (src === beforeType) {
      throw new Error(
        'withReleaseSigning: could not find `signingConfig signingConfigs.debug` ' +
          'inside the release build type. The Expo template changed. Update ' +
          'this plugin. Do not leave release builds debug-signed.'
      );
    }

    // 3. Refuse release builds that lack the signing properties.
    src = src.replace(/\s*$/, '\n') + RELEASE_GUARD;

    cfg.modResults.contents = src;
    return cfg;
  });
};
