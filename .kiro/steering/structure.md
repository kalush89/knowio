# Project Structure

## High-Level Directory Structure

The project will follow a standard Next.js directory structure, with a few key additions for the RAG system's specific components.

/
├── .next/                  # Next.js build output
├── node_modules/           # Project dependencies
├── public/                 # Static assets (images, fonts, etc.)
├── prisma/                 # Prisma schema and migrations
├── src/                    # All source code
│   ├── app/                # Next.js App Router
│   │   ├── api/            # API Routes
│   │   │   ├── chat/
│   │   │   │   └── route.ts
│   │   │   └── ingest-url/
│   │   │       └── route.ts
│   │   ├── (auth)/         # Authentication routes via NextAuth.js
│   │   │   └── sign-in/
│   │   │       └── page.tsx
│   │   ├── layout.tsx
│   │   └── page.tsx        # Main chat interface
│   ├── components/         # Reusable UI components (e.g., shadcn/ui components)
│   │   ├── chat/           # Components specific to the chat interface
│   │   └── ui/             # shadcn/ui components
│   ├── lib/                # Library code and utilities
│   │   ├── actions/        # Server Actions (if used)
│   │   ├── auth.ts         # NextAuth.js configuration
│   │   ├── db.ts           # Prisma client instance
│   │   ├── embed/          # Embedding logic for AWS Bedrock
│   │   ├── ingest/         # Scraping and chunking pipeline logic
│   │   ├── prompt/         # Prompt engineering templates
│   │   └── utils.ts        # General utilities
├── .env.local              # Environment variables
├── .gitignore
├── tsconfig.json
├── package.json
└── .kiro/                  # Kiro's configuration and specs
    ├── steering/
    │   ├── product.md
    │   ├── tech.md
    │   └── structure.md
    └── specs/
        

---

## Core Components

* **`src/app/page.tsx`**: The main page component that contains the chat interface for user interaction.
* **`src/app/api/chat/route.ts`**: The API route handler for processing user queries. It will orchestrate the retrieval (from PostgreSQL) and generation (via AWS Bedrock) steps.
* **`src/app/api/ingest-url/route.ts`**: The API route handler for ingesting new documentation. This route will trigger the scraping and indexing pipeline.
* **`src/lib/ingest/`**: This directory will contain the scraping logic (e.g., using Playwright), the document loaders, and the chunking strategy.
* **`src/lib/embed/`**: This will hold the logic for interacting with the AWS Bedrock embedding model to create vector representations of text.
* **`prisma/schema.prisma`**: The Prisma schema file that defines the `DocumentChunk` model, including its `vector` field, and any other necessary data models for the application.
* **`src/lib/auth.ts`**: The configuration file for NextAuth.js, defining providers and the Prisma adapter.
* **`src/components/chat/`**: This directory will contain all the components that make up the chat UI, such as the message display, input form, and any loading indicators.