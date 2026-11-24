-- AlterTable
ALTER TABLE "rag_qa_pairs" ADD COLUMN "show_in_faq" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "rag_qa_pairs_show_in_faq_idx" ON "rag_qa_pairs"("show_in_faq");

-- Seed: FAQ estático anterior da homepage (só site; RAG off até gerarem embedding).
INSERT INTO "rag_qa_pairs" ("id", "question", "answer", "embedding", "embedding_model", "is_active", "show_in_faq", "created_at", "updated_at")
VALUES
(
  'rag_faq_seed_01',
  'O que é a Move Casa e como ela pode me ajudar?',
  'A Move Casa Relocation acompanha brasileiros em todo o processo de mudança para Portugal — desde vistos e documentos até NIF, conta bancária, moradia e apoio na chegada. Somos fundadas por quem já passou por essa jornada e conhece os desafios na prática.',
  '[]',
  'text-embedding-3-small',
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'rag_faq_seed_02',
  'Preciso de visto para morar em Portugal?',
  'Sim — para morar em Portugal, brasileiros precisam de visto de residência. O pedido deve ser feito ainda no Brasil, com pelo menos 3 meses de antecedência antes da viagem. Existem modalidades para trabalho, estudo, reagrupamento familiar, D7, D8 e outras situações. Na consulta inicial avaliamos seu perfil e indicamos o caminho mais adequado.',
  '[]',
  'text-embedding-3-small',
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'rag_faq_seed_03',
  'Como saber qual visto é o ideal para o meu perfil?',
  'Para saber exatamente o tipo de visto que se enquadra melhor para você, temos parceria com a Clara, que faz toda a assessoria migratória. A reunião estratégica dela custa R$ 180 e serve para mapear seu caso, esclarecer dúvidas e definir o melhor caminho antes de dar os próximos passos.',
  '[]',
  'text-embedding-3-small',
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'rag_faq_seed_04',
  'Quanto tempo demora o processo de imigração?',
  'O prazo varia conforme o tipo de visto, a documentação disponível e os tempos de resposta dos órgãos portugueses. Em média, o planejamento completo pode levar de alguns meses a mais de um ano. A gente ajuda a organizar cada etapa para evitar atrasos desnecessários.',
  '[]',
  'text-embedding-3-small',
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'rag_faq_seed_05',
  'A Move Casa ajuda a encontrar moradia?',
  'Sim — cuidamos de ponta a ponta. Hoje a Move Casa é quem faz o relocation: os imóveis que você vê aqui são administrados por nós, do primeiro contato até a entrega das chaves. A ideia é simples: você desembarca em Portugal com casa pronta — contas de água, luz e internet já resolvidas, tudo limpo e funcionando — e a gente te mostra a cidade com as dicas que só quem mora aqui conhece.',
  '[]',
  'text-embedding-3-small',
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'rag_faq_seed_06',
  'Quais documentos preciso para começar?',
  'Os documentos variam conforme o visto, mas costumam incluir passaporte válido, comprovantes de renda ou meios de subsistência, seguro de saúde e formulários específicos. Na primeira conversa enviamos uma checklist personalizada para o seu caso.',
  '[]',
  'text-embedding-3-small',
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
