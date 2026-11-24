-- CreateTable
CREATE TABLE "rag_qa_pairs" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "embedding_model" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_qa_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rag_qa_pairs_is_active_idx" ON "rag_qa_pairs"("is_active");
