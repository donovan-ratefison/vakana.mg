# Vakana: task runner
#
# Run `make` (or `make help`) to see every target.
# Override ANDROID_HOME on the command line if your SDK lives elsewhere:
#   make apk ANDROID_HOME=/opt/android-sdk

SHELL := /bin/bash

ANDROID_HOME       ?= $(HOME)/app/Android/Sdk
export ANDROID_HOME
export ANDROID_SDK_ROOT := $(ANDROID_HOME)
export PATH := $(ANDROID_HOME)/cmdline-tools/latest/bin:$(ANDROID_HOME)/platform-tools:$(PATH)

APK_DEBUG   := android/app/build/outputs/apk/debug/app-debug.apk
APK_RELEASE := android/app/build/outputs/apk/release/app-release.apk
PKG         ?= mg.vakana

.DEFAULT_GOAL := help

.PHONY: help install start dev run-android run-ios run-web \
        prebuild prebuild-clean apk apk-debug apk-release verify-apk release-check \
        install-apk uninstall-apk logcat \
        clean clean-android clean-gradle clean-all \
        sdk-status doctor version

help: ## Show this help.
	@awk 'BEGIN {FS = ":.*?## "; printf "Vakana: make targets\n\n"} \
	      /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---- JS / Expo ----------------------------------------------------------

install: ## Install npm dependencies.
	npm install

start: ## Start the Expo dev server (QR + menu).
	npm start

dev: start ## Alias for `start`.

run-android: ## Open the app on a connected Android device/emulator via Expo.
	npm run android

run-ios: ## Open in iOS simulator (macOS only).
	npm run ios

run-web: ## Open in the browser.
	npm run web

# ---- Native Android prebuild -------------------------------------------

prebuild: android/build.gradle ## Generate android/ if missing (idempotent).

android/build.gradle:
	npx expo prebuild --platform android

prebuild-clean: ## Regenerate android/ from scratch.
	npx expo prebuild --platform android --clean

# ---- APK build ----------------------------------------------------------

apk: apk-release ## Default: build a self-contained APK you can sideload (alias for apk-release).

apk-debug: prebuild ## Build a debug APK. `make start` must run on this machine to load the JS.
	cd android && ./gradlew assembleDebug
	@echo
	@echo "  → $(APK_DEBUG)"

# Always from a fresh prebuild: a stale android/ ships the previous
# versionCode/versionName (app.json is only read at prebuild time).
# Fails without VAKANA_RELEASE_* in ~/.gradle/gradle.properties: there is
# no debug-key fallback any more (plugins/withReleaseSigning.js).
apk-release: prebuild-clean ## Build a self-contained release APK (fresh prebuild, Vakana.mg release key), then verify its signer.
	cd android && ./gradlew assembleRelease
	@echo
	@echo "  → $(APK_RELEASE)"
	@$(MAKE) --no-print-directory verify-apk

verify-apk: ## Check the release APK is signed with the real key, not the debug one.
	@APKSIGNER=$$(ls -d $(ANDROID_HOME)/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1); \
	if [ -z "$$APKSIGNER" ]; then echo "apksigner not found under $(ANDROID_HOME)/build-tools"; exit 1; fi; \
	if [ ! -f $(APK_RELEASE) ]; then echo "no release APK: run 'make apk-release' first"; exit 1; fi; \
	OWNER=$$($$APKSIGNER verify --print-certs $(APK_RELEASE) 2>/dev/null | grep -m1 'Signer #1 certificate DN'); \
	echo "$$OWNER"; \
	case "$$OWNER" in \
	  *"CN=Android Debug"*) echo; echo "✗ DEBUG-SIGNED. Do not publish."; \
	    echo "  Release signing needs VAKANA_RELEASE_* in ~/.gradle/gradle.properties;"; \
	    echo "  a stale android/ may predate the no-fallback guard. Rebuild with 'make apk-release'."; exit 1 ;; \
	  *"CN=Vakana.mg"*) echo; echo "✓ signed with the Vakana.mg release key." ;; \
	  *) echo; echo "? unrecognised signer. Examine the signer before you publish."; exit 1 ;; \
	esac

release-check: ## Pre-release gate: expo-doctor, guide anchors, versionCode above the latest tag's.
	npx expo-doctor
	node scripts/check-guide-anchors.mjs
	@TAG=$$(git tag --list 'v*' --sort=-v:refname | head -1); \
	if [ -z "$$TAG" ]; then echo "no v* tag found: cannot compare versionCode"; exit 1; fi; \
	CUR=$$(node -p "require('./app.json').expo.android.versionCode"); \
	PREV=$$(git show "$$TAG:app.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).expo.android.versionCode"); \
	printf "%-12s %s\n" "versionCode:" "$$CUR (app.json) vs $$PREV ($$TAG)"; \
	if [ "$$CUR" -le "$$PREV" ]; then \
	  echo "✗ versionCode $$CUR is not greater than $$PREV at $$TAG. Bump android.versionCode in app.json."; exit 1; \
	fi; \
	echo "✓ release-check passed."

# ---- Device ops ---------------------------------------------------------

install-apk: ## Sideload the release APK on the connected device (adb install -r).
	adb install -r $(APK_RELEASE)

install-apk-debug: ## Sideload the debug APK (only works while Metro is running).
	adb install -r $(APK_DEBUG)

uninstall-apk: ## Remove Vakana from the connected device.
	adb uninstall $(PKG) || true

logcat: ## Stream device logs filtered to Vakana.
	adb logcat --pid=$$(adb shell pidof -s $(PKG))

# ---- Clean --------------------------------------------------------------

clean-android: ## Remove the generated android/ folder.
	rm -rf android

clean-gradle: ## Run ./gradlew clean if android/ exists.
	@if [ -d android ]; then cd android && ./gradlew clean; else echo "android/ not present: nothing to clean"; fi

clean: clean-android ## Same as clean-android.

clean-all: clean ## Also remove node_modules and the Expo cache.
	rm -rf node_modules .expo

# ---- Toolchain ----------------------------------------------------------

sdk-status: ## List installed Android SDK packages.
	@$(ANDROID_HOME)/cmdline-tools/latest/bin/sdkmanager --list_installed

doctor: ## Sanity-check the toolchain.
	@printf "%-25s %s\n" "ANDROID_HOME"            "$(ANDROID_HOME)"
	@command -v java       >/dev/null && printf "%-25s %s\n" "java"               "$$(java -version 2>&1 | head -1)"  || printf "%-25s %s\n" "java" "missing"
	@command -v adb        >/dev/null && printf "%-25s %s\n" "adb"                "$$(adb --version | head -1)"        || printf "%-25s %s\n" "adb"  "missing"
	@test -x $(ANDROID_HOME)/cmdline-tools/latest/bin/sdkmanager && printf "%-25s %s\n" "sdkmanager"             "ok" || printf "%-25s %s\n" "sdkmanager" "missing at $(ANDROID_HOME)/cmdline-tools/latest/bin"
	@test -d $(ANDROID_HOME)/platforms/android-35                && printf "%-25s %s\n" "platforms/android-35"   "ok" || printf "%-25s %s\n" "platforms/android-35" "missing"
	@test -d $(ANDROID_HOME)/build-tools/35.0.0                  && printf "%-25s %s\n" "build-tools/35.0.0"     "ok" || printf "%-25s %s\n" "build-tools/35.0.0"   "missing"
	@test -d $(ANDROID_HOME)/ndk/27.1.12297006                   && printf "%-25s %s\n" "ndk/27.1.12297006"      "ok" || printf "%-25s %s\n" "ndk/27.1.12297006"    "missing"
	@test -d node_modules && printf "%-25s %s\n" "node_modules"        "present" || printf "%-25s %s\n" "node_modules" "missing: run 'make install'"
	@test -f android/build.gradle && printf "%-25s %s\n" "android/ prebuilt" "yes" || printf "%-25s %s\n" "android/ prebuilt" "no: run 'make prebuild'"

version: ## Print the current package and tag.
	@node -p "require('./package.json').version" 2>/dev/null | xargs -I{} printf "%-12s %s\n" "package:" "{}"
	@git describe --tags --abbrev=0 2>/dev/null | xargs -I{} printf "%-12s %s\n" "git tag:" "{}"

