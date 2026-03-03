# @kyra/sdk

Kyra governance SDK for LangChain.js and LangGraph agents.

## Install

```bash
npm install @kyra/sdk
```

## Quick start

```typescript
import { KyraGovernor } from "@kyra/sdk";

const governor = new KyraGovernor({ apiKey: "kyra_sk_..." });
const governedTools = governor.wrap(tools);
// Use governedTools with your LangChain.js agent
```

## Build

```bash
npm install
npm run build
```

## Test

```bash
npm test
```

## Publish

```bash
npm publish --access public
```
