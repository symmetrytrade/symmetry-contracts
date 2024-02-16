module.exports = {
    env: {
        browser: true,
        es2021: true,
        node: true,
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended-type-checked",
        "plugin:prettier/recommended",
    ],
    overrides: [],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: "latest",
        project: true,
        sourceType: "module",
    },
    plugins: ["@typescript-eslint", "no-only-tests"],
    rules: {
        eqeqeq: "error",
    },
    ignorePatterns: [".eslintrc.js"],
};
