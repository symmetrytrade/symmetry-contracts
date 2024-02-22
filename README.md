# Symmetry Trade

[![Tests](https://github.com/symmetrytrade/symmetry-contracts/actions/workflows/tests.yml/badge.svg)](https://github.com/symmetrytrade/symmetry-contracts/actions/workflows/tests.yml)

This repository contains the smart contracts source code for Symmetry Trade.

## Installation

```bash
yarn
```

## Compile

```bash
yarn build
```

## Preparation

Set `DEPLOYER_KEY` in `.env` file.

## Deploy

```bash
yarn deploy <network>
```

## Export

```bash
yarn hardhat --network <network> export --export <export_file_path>
```
