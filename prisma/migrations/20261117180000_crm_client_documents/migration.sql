-- CreateTable
CREATE TABLE "rafa_call_crm_documents" (
    "id" TEXT NOT NULL,
    "whatsapp_digits" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rafa_call_crm_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rafa_call_crm_documents_whatsapp_digits_created_at_idx" ON "rafa_call_crm_documents"("whatsapp_digits", "created_at");
