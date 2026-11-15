# fn-comic-db — Backend Deployment Guide

Java 17 Azure Function App backed by Azure Cosmos DB.
For frontend deployment, see `../comic-book-db/DEPLOY.md`.

---

## Platform & Services

This app is built and operated using the following services:

| Service | Purpose | Cost |
|---|---|---|
| Azure Cosmos DB (Serverless) | NoSQL database for comics, users, sessions, carts | Pay-per-use |
| Azure Function App | Serverless Java backend API | Pay-per-use |
| Azure Static Web Apps | Hosts the Angular frontend | Free tier |
| Namecheap DNS | Custom domain (`example.com`) | ~$15/yr |
| Namecheap Private Email | Transactional email via SMTP (`privateemail.com`) | ~$14/yr |
| GitHub | Source code hosting | Free |
| Claude AI | Coding assistant used to build and maintain the app | ~$20/mo |

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Azure Resource Overview](#azure-resource-overview)
3. [Local Development](#local-development)
4. [RBAC Roles](#rbac-roles)
5. [Private Email SMTP Setup](#private-email-smtp-setup)
6. [Cosmos DB Setup](#cosmos-db-setup)
7. [CORS Configuration](#cors-configuration)
8. [Build & Deploy](#build--deploy)

---

## Prerequisites

| Tool | Purpose |
|---|---|
| JDK — use the laptop default (Temurin 25) | Compile the function code. The pom targets Java 17 *bytecode* to match the Function App runtime, but Temurin 25 builds it correctly (verified: 73 tests pass, classes emit major version 61). **Do not install a JDK 17 to build this** — see the 2026-09-24 note in the root `DEPLOY.md`. |
| `./mvnw` (Maven Wrapper, in this directory) | Build and package the Function App. **Do not install Maven** — the wrapper is the supported entry point, see below. |
| Azure CLI (`az`) | Deploy and manage Azure resources |
| Azure Functions Core Tools v4 | Run functions locally, and package for deploy |

### Building: use `./mvnw`, not `mvn`

`./mvnw` is the supported build entry point for this backend. It pins Maven 3.9.16
(see `.mvn/wrapper/maven-wrapper.properties`), downloads it on first use, and needs
nothing on `PATH` but a JDK.

A bare `mvn` only works in an interactive shell, where SDKMAN puts it on `PATH` from
`~/.zshrc`. Scripts, cron jobs, and CI runners get a non-interactive shell, never read
`~/.zshrc`, and so have no `mvn` at all. Every build command below is written `./mvnw`
for that reason — substituting `mvn` will work on the owner's laptop and fail in CI.

Verified 2026-09-25 with no SDKMAN on `PATH`
(`env -i HOME=$HOME /bin/zsh -c 'cd <repo>/fn-comic-db && ./mvnw clean package'`):
BUILD SUCCESS, 73 tests, 0 failures, on the clean-shell JDK (Temurin 25.0.2) — which is
the same "laptop default JDK" path recorded above, now confirmed to hold headlessly too.

In GitHub Actions, pin the JDK with `actions/setup-java` + Temurin and call `./mvnw`.
Never rely on SDKMAN there. `func` (Core Tools v4) must also be on `PATH` — the
`azure-functions:package` goal shells out to it and fails the build without it.

```bash
brew install azure-cli azure-functions-core-tools@4
az login
az account set --subscription "<your-subscription-id>"
```

---

## Azure Resource Overview

| Resource | Name | Resource Group | Region |
|---|---|---|---|
| Function App | `your-function-app` | `my-resource-group` | `westus2` |
| App Service Plan | `java-functions-app-service-plan` | `my-resource-group` | `westus2` |
| Cosmos DB Account | `your-cosmos-account` | `my-resource-group` | `westus2` |
| Cosmos DB Database | `comic-db` | — | — |
| Cosmos DB Container | `comics` | partition key: `/id` | — |
| Cosmos DB Container | `images` | partition key: `/id` | — |
| Cosmos DB Container | `users` | partition key: `/id` | — |
| Cosmos DB Container | `sessions` | partition key: `/id` | — |
| Cosmos DB Container | `carts` | partition key: `/id` | — |
| Cosmos DB Container | `discounts` | partition key: `/id` | — |
| Cosmos DB Container | `archived-orders` | partition key: `/id` | — |
| Cosmos DB Container | `return-events` | partition key: `/id` | — |
| Cosmos DB Container | `audit-logs` | partition key: `/id` | — |
| Cosmos DB Container | `activity-logs` | partition key: `/id` | — |
| Static Web App (frontend) | `comic-book-db` | `my-resource-group` | — |
| Storage Account | *(auto-provisioned with Function App)* | `my-resource-group` | `westus2` |
| Application Insights | *(auto-provisioned with Function App)* | `my-resource-group` | `westus2` |

---

## Local Development

Create `local.settings.json` in the project root. **Do not commit this file** — it is gitignored.

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "java",
    "COSMOS_ENDPOINT": "https://<your-cosmos-account>.documents.azure.com:443/",
    "ADMIN_EMAIL": "<your-admin-email>",
    "SITE_URL": "http://localhost:4200",
    "EMAIL_ENABLED": "true",
    "SMTP_HOST": "mail.privateemail.com",
    "SMTP_USERNAME": "<your-smtp-username>",
    "SMTP_PASSWORD": "<your-smtp-password>",
    "AWARD_MODE_ENABLED": "true",
    "BIDDING_MODE": "false",
    "BIDDING_CYCLE": "10",
    "FINALIZE_HOURS": "20",
    "CART_EXPIRY_DAYS": "7",
    "DASHBOARD_PAGE_SIZE": "500"
  }
}
```

`DefaultAzureCredential` is used for Cosmos DB authentication — no key is needed. It picks up your active Azure CLI session automatically.

```bash
az login
./mvnw clean package -DskipTests
./mvnw azure-functions:run
```

The local API will be available at `http://localhost:7071/api/`.

---

## RBAC Roles

### Developer Deployment Roles

The deploying account needs the following on the `my-resource-group` resource group:

| Role | Reason |
|---|---|
| `Contributor` | Deploy Function App and Static Web App |

```bash
az role assignment create \
  --assignee "<developer-email-or-object-id>" \
  --role "Contributor" \
  --scope "/subscriptions/<subscription-id>/resourceGroups/my-resource-group"
```

### Function App Managed Identity (Cosmos DB Keyless Auth)

The Function App uses `DefaultAzureCredential` — no Cosmos DB key is stored anywhere. The Function App's System-Assigned Managed Identity must be granted the **Cosmos DB Built-in Data Contributor** role.

**Step 1: Enable System-Assigned Managed Identity**
```bash
az functionapp identity assign \
  --name your-function-app \
  --resource-group my-resource-group
```
Note the `principalId` in the output.

**Step 2: Grant Cosmos DB access to the identity**
```bash
az cosmosdb sql role assignment create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --role-definition-name "Cosmos DB Built-in Data Contributor" \
  --principal-id <principal-id-from-step-1> \
  --scope "/subscriptions/<subscription-id>/resourceGroups/my-resource-group/providers/Microsoft.DocumentDB/databaseAccounts/your-cosmos-account"
```

**Step 3: Set the Cosmos DB endpoint app setting** (endpoint only — no key)
```bash
az functionapp config appsettings set \
  --name your-function-app \
  --resource-group my-resource-group \
  --settings "COSMOS_ENDPOINT=https://<your-cosmos-account>.documents.azure.com:443/"
```

**Step 4: Set ADMIN_EMAIL** (the email address that receives admin privileges on first registration; must match `SMTP_USERNAME` when the email form is enabled)
```bash
az functionapp config appsettings set \
  --name your-function-app \
  --resource-group my-resource-group \
  --settings "ADMIN_EMAIL=<your-admin-email>"
```

### Storage Account & Application Insights

Both are **auto-provisioned** when the Function App is created via the Azure portal or `az functionapp create`. They do not require manual RBAC assignments — the Function App's connection strings (`AzureWebJobsStorage`, `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING`) and instrumentation key (`APPINSIGHTS_INSTRUMENTATIONKEY`) are injected automatically as app settings at provisioning time.

> If you ever need to rotate the Storage Account key, update `AzureWebJobsStorage` and `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING` in the Function App settings and redeploy.

---

## PrivateEmail.Com SMTP Setup (from Namecheap)

The contact form sends email via **STARTTLS SMTP** against `mail.privateemail.com` (Namecheap Private Email) on port 587, using plain username/password auth via JavaMail (`com.sun.mail:jakarta.mail`).

The contact form can be toggled on or off with the `EMAIL_ENABLED` app setting (`true`/`false`). When `false`, the Angular frontend hides the form entirely. Defaults to `true` if the setting is absent.

> **Note:** `SMTP_USERNAME` and `ADMIN_EMAIL` should be the same address. `ADMIN_EMAIL` identifies the single admin user; `SMTP_USERNAME` is the mailbox that sends and receives contact form emails.

| Setting | Value |
|---|---|
| `SMTP_HOST` | `mail.privateemail.com` |
| Port | `587` (STARTTLS) |
| `SMTP_USERNAME` | your full email address |
| `SMTP_PASSWORD` | your mailbox password |

### Add App Settings to the Function App

```bash
# Remove old Gmail vars (if migrating)
az functionapp config appsettings delete \
  --name your-function-app --resource-group my-resource-group \
  --setting-names GMAIL_ENABLED GMAIL_USERNAME GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET GMAIL_REFRESH_TOKEN

# Set new SMTP vars
az functionapp config appsettings set \
  --name your-function-app \
  --resource-group my-resource-group \
  --settings \
    ADMIN_EMAIL="john.doe@example.com" \
    EMAIL_ENABLED="true" \
    SMTP_HOST="mail.privateemail.com" \
    SMTP_USERNAME="john.doe@example.com" \
    SMTP_PASSWORD="<your-smtp-password>"
```

To disable the contact form without redeploying, set `EMAIL_ENABLED=false` — the frontend will hide the form on next load.

### Add to local.settings.json for local development

```json
{
  "Values": {
    "EMAIL_ENABLED": "true",
    "SMTP_HOST": "mail.privateemail.com",
    "SMTP_USERNAME": "john.doe@example.com",
    "SMTP_PASSWORD": "<your-smtp-password>"
  }
}
```

---

## Serverless Cosmos DB Setup

Run these only when creating the database from scratch.  Because CosmosDB needs to be serverless, I would create the database by hand.

```bash
# Create database
#az cosmosdb sql database create \
#  --account-name your-cosmos-account \
#  --resource-group my-resource-group \
#  --name comic-db

# Create comics container
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name comics \
  --partition-key-path "/id"

# Create images container
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name images \
  --partition-key-path "/id"

# Create users container (Phase 1 auth)
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name users \
  --partition-key-path "/id"

# Create sessions container (Phase 1 auth)
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name sessions \
  --partition-key-path "/id"

# Create carts container (Phase 2 claims)
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name carts \
  --partition-key-path "/id"

# Create discounts container
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name discounts \
  --partition-key-path "/id"

# Create archived-orders container (fulfilled order history)
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name archived-orders \
  --partition-key-path "/id"

# Create return-events container (pruned periodically by ReturnEventPrunerTrigger)
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name return-events \
  --partition-key-path "/id"

# Create audit-logs container (per-comic field change history)
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name audit-logs \
  --partition-key-path "/id"

# Create activity-logs container (claim/return event stream)
az cosmosdb sql container create \
  --account-name your-cosmos-account \
  --resource-group my-resource-group \
  --database-name comic-db \
  --name activity-logs \
  --partition-key-path "/id"
```

---

## CORS Configuration

The Angular frontend must be listed as an allowed origin on the Function App. Azure Functions handles OPTIONS preflight at the platform level using this list — the code-level `Access-Control-Allow-Origin` headers alone are not sufficient.

**Current allowed origins** (as of 2026-03-11):
- `https://example.com` — production custom domain
- `https://your-static-web-app.azurestaticapps.net` — original Azure Static Web Apps URL (kept for backwards compatibility)
- `http://localhost:4200` — local development

```bash
# Allow the production custom domain
az functionapp cors add \
  --name your-function-app \
  --resource-group my-resource-group \
  --allowed-origins "https://example.com"

# Allow the Azure Static Web Apps URL (original domain)
az functionapp cors add \
  --name your-function-app \
  --resource-group my-resource-group \
  --allowed-origins "https://your-static-web-app.azurestaticapps.net"

# Allow local development
az functionapp cors add \
  --name your-function-app \
  --resource-group my-resource-group \
  --allowed-origins "http://localhost:4200"

# Verify
az functionapp cors show \
  --name your-function-app \
  --resource-group my-resource-group
```

> **Note:** When adding a new frontend domain (e.g. a custom domain or new Static Web Apps URL), always run `az functionapp cors add` with the new origin — otherwise all API requests from that domain will fail with CORS errors.

---

## Build & Deploy

```bash
# Build and package
./mvnw clean package -DskipTests

# Deploy to Azure (uses active az login session)
./mvnw clean package azure-functions:deploy
```

Deployment configuration is in `pom.xml` under `azure-functions-maven-plugin`. No secrets are required.
