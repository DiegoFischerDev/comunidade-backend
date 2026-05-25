/**
 * Lógica do quiz público de financiamento — portado do receiver `wa-verify`.
 *
 * O quiz qualifica leads que querem perceber se conseguem financiar uma casa em Portugal.
 * Está dividido em duas trilhas (residente vs. estrangeiro) e cinco/seis perguntas SIM/NÃO,
 * mais uma de estado civil. Devolve uma "outcome" com texto explicativo + exemplo prático.
 */

export type YesNo = 'SIM' | 'NAO';
export type MaritalStatus = 'casado' | 'solteiro';
export type Track = 'resident' | 'foreign';

export type FinancingQuizAnswers = {
  residencePt: YesNo;
  mode: MaritalStatus;
  // Residente:
  q2?: YesNo; // possui Cartão de Cidadão / Título de Residência
  q3?: YesNo; // possui Contrato de Trabalho Efetivo (CTEF)
  q7?: YesNo; // 10% de entrada (só quando q3 = NAO)
  q5?: YesNo; // menos de 35 anos
  capitalOk?: YesNo; // % de capitais próprios para entrada
  capitalPercent?: 10 | 20;
  // Estrangeiro:
  foreignCtef?: YesNo;
  foreignCapital?: YesNo;
};

export type FinancingOutcomeKey =
  | '100'
  | '90'
  | '80'
  | 'foreign-80'
  | 'indef-sem-ctef-10'
  | 'inviavel'
  | 'fallback';

export type FinancingOutcome = {
  key: FinancingOutcomeKey;
  comment: string;
  body: string;
};

/** Casa o regime de uma das duas trilhas. */
export function resolveTrack(residencePt: YesNo): Track {
  return residencePt === 'SIM' ? 'resident' : 'foreign';
}

/** % de entrada exigida em função das respostas residentes (ou null se ainda não aplicável). */
export function computeRequiredCapitalPercent(
  q2: YesNo | undefined,
  q3: YesNo | undefined,
  q5: YesNo | undefined,
): 10 | 20 | null {
  if (q2 === 'NAO' && q3 === 'SIM') return 20;
  if (q2 === 'SIM' && q3 === 'SIM' && q5 === 'NAO') return 10;
  return null;
}

/**
 * Detalhe pergunta→resposta (uma entrada por pergunta efetivamente respondida pelo lead).
 * Usado tanto no comentário do lead na `ia-app` como no corpo do email enviado ao lead.
 *
 * As perguntas reproduzem o texto da `renderQuestion` do frontend (formato natural em PT)
 * para que o admin/gestora consiga reconstruir a conversa sem ambiguidade.
 */
export type QuizAnswerBreakdownItem = { question: string; answer: string };

export function buildAnswersBreakdown(
  answers: FinancingQuizAnswers,
): QuizAnswerBreakdownItem[] {
  const isCasado = answers.mode === 'casado';
  const possessivoTem = isCasado ? 'Pelo menos um dos dois' : 'Você';
  const possessivoTeria = isCasado ? 'Vocês teriam' : 'Você teria';
  const out: QuizAnswerBreakdownItem[] = [];

  if (answers.residencePt) {
    out.push({
      question: 'Você já mora em Portugal?',
      answer:
        answers.residencePt === 'SIM'
          ? 'Sim, já moro em Portugal'
          : 'Ainda não moro',
    });
  }
  if (answers.mode) {
    out.push({
      question: 'Estado civil',
      answer: isCasado ? 'Casado(a) / União de facto' : 'Solteiro(a)',
    });
  }

  if (answers.residencePt === 'NAO') {
    if (answers.foreignCtef) {
      out.push({
        question: `${possessivoTem} ${
          isCasado ? 'possuem' : 'possui'
        } Contrato de Trabalho Efetivo?`,
        answer:
          answers.foreignCtef === 'SIM'
            ? 'Sim'
            : 'Não / Recibos verdes / Termo',
      });
    }
    if (answers.foreignCapital) {
      out.push({
        question: `${possessivoTeria} 20% do valor da casa em capitais próprios para a entrada?`,
        answer: answers.foreignCapital === 'SIM' ? 'Sim, conseguiria' : 'Não',
      });
    }
    return out;
  }

  if (answers.q2) {
    out.push({
      question: isCasado
        ? 'Pelo menos um dos dois já possui Cartão de Cidadão ou Título de Residência (no formato cartão)?'
        : 'Já possui Cartão de Cidadão ou Título de Residência (no formato cartão)?',
      answer: answers.q2 === 'SIM' ? 'Sim' : 'Ainda não',
    });
  }
  if (answers.q3) {
    out.push({
      question: `${possessivoTem} ${
        isCasado ? 'possuem' : 'possui'
      } Contrato de Trabalho Efetivo?`,
      answer: answers.q3 === 'SIM' ? 'Sim' : 'Não / Recibos verdes / Termo',
    });
  }
  if (answers.q7) {
    out.push({
      question: isCasado
        ? 'Teriam 10% do valor da casa em capitais próprios para dar de entrada?'
        : 'Teria 10% do valor da casa em capitais próprios para dar de entrada?',
      answer: answers.q7 === 'SIM' ? 'Sim, conseguiria' : 'Não',
    });
  }
  if (answers.q5) {
    out.push({
      question: isCasado
        ? 'Ambos têm menos de 35 anos?'
        : 'Tem menos de 35 anos?',
      answer: answers.q5 === 'SIM' ? 'Sim' : 'Não',
    });
  }
  if (answers.capitalOk) {
    const pct = answers.capitalPercent ?? 20;
    out.push({
      question: `${possessivoTeria} ${pct}% do valor da casa em capitais próprios para dar de entrada?`,
      answer: answers.capitalOk === 'SIM' ? `Sim, ${pct}% ou mais` : 'Não',
    });
  }
  return out;
}

/**
 * Constrói um resumo curto das respostas (em português) — usado como linha-resumo curta no
 * topo do comentário do lead. Mantém o formato do receiver wa-verify para os admins
 * continuarem a ver o mesmo estilo.
 */
export function buildQuizSummary(answers: FinancingQuizAnswers): string {
  const a = answers;
  const modeLabel =
    a.mode === 'casado'
      ? 'Casado'
      : a.mode === 'solteiro'
        ? 'Solteiro'
        : 'Indefinido';
  const parts: string[] = [];
  if (a.residencePt)
    parts.push(a.residencePt === 'SIM' ? 'mora em PT' : 'não mora em PT');
  parts.push(modeLabel);
  if (a.q2) parts.push(a.q2 === 'SIM' ? 'tem AR/CC' : 'sem AR/CC');
  if (a.q3 || a.foreignCtef) {
    const ctef = a.q3 ?? a.foreignCtef;
    parts.push(ctef === 'SIM' ? 'tem CTEF' : 'sem CTEF');
  }
  if (a.q7) parts.push(`entrada 10%: ${a.q7 === 'SIM' ? 'sim' : 'não'}`);
  if (a.q5) parts.push(a.q5 === 'SIM' ? 'menos de 35 anos' : '35 anos ou mais');
  if (a.capitalOk || a.foreignCapital) {
    const cap = a.capitalOk ?? a.foreignCapital;
    const pct = a.capitalPercent ?? (a.foreignCapital ? 20 : null);
    if (pct) {
      parts.push(`entrada ${pct}%: ${cap === 'SIM' ? 'sim' : 'não'}`);
    } else {
      parts.push(`capitais: ${cap === 'SIM' ? 'sim' : 'não'}`);
    }
  }
  return parts.join(', ');
}

export function classifyFinancingAnswers(
  q2: YesNo | undefined,
  q3: YesNo | undefined,
  q5: YesNo | undefined,
  q7: YesNo | undefined,
): FinancingOutcome {
  if (q3 === 'NAO' && q7 !== 'SIM') {
    return {
      key: 'inviavel',
      comment: 'Sem viabilidade identificada no questionário',
      body: 'Resultado inviável:\n❌ Infelizmente com recibos verdes ou contrato temporário fica muito difícil conseguir aprovação de crédito. Talvez ainda não seja o momento de tentar. Ter um contrato de trabalho efetivo é o principal fator para a aprovação dos créditos.',
    };
  }
  if (q3 === 'NAO' && q7 === 'SIM') {
    return {
      key: 'indef-sem-ctef-10',
      comment:
        'Possível viabilidade a confirmar (sem CTEF, com ~10% de entrada)',
      body: 'Resultado indefinido:\n✅ Sem contrato de trabalho efetivo, os bancos tendem a ser mais exigentes; ao indicar que dispõe de cerca de 10% em capitais próprios para entrada, o seu caso deixa de ser automaticamente inviável e pode haver margem para analisar soluções com um gestor de crédito. Não é garantia de aprovação, mas vale reunir a documentação e pedir uma avaliação personalizada.',
    };
  }
  if (q2 === 'SIM' && q3 === 'SIM' && q5 === 'SIM') {
    return {
      key: '100',
      comment: 'Possível viabilidade de 100%',
      body: 'Resultado 100%:\n✅ Em termos gerais, você tem viabilidade para aprovação de financiamento de 100% do valor da casa!',
    };
  }
  if (q2 === 'NAO' && q3 === 'SIM') {
    return {
      key: '80',
      comment: 'Possível viabilidade de 80%',
      body: 'Resultado 80%:\n✅ Em termos gerais, você tem viabilidade para aprovação de financiamento de cerca de 80% do valor da casa. Nesse cenário costuma ser necessário cerca de 20% de entrada com capitais próprios (regra habitual quando ainda não há cartão de residência no formato de cartão).',
    };
  }
  if (q2 === 'SIM' && q3 === 'SIM' && q5 === 'NAO') {
    return {
      key: '90',
      comment: 'Possível viabilidade de 90%',
      body: 'Resultado 90%:\n✅ Em termos gerais, você tem viabilidade para aprovação de financiamento de 90% do valor da casa. E aí teria de dar 10% de entrada com capitais próprios.',
    };
  }
  return {
    key: 'fallback',
    comment: 'Possível viabilidade a confirmar (caso com particularidades)',
    body: 'Resultado indefinido:\n✅ Em termos gerais o seu caso tem particularidades. Vale a pena tentar e falar com um gestor de crédito para analisar o seu caso em detalhe.',
  };
}

export function classifyForeignInvestorAnswers(
  q3: YesNo | undefined,
  capitalOk: YesNo | undefined,
): FinancingOutcome {
  if (q3 === 'NAO') {
    return {
      key: 'inviavel',
      comment: 'Sem viabilidade (não reside em PT, sem CTEF)',
      body: 'Resultado inviável:\n❌ Sem contrato de trabalho efetivo, é muito difícil obter aprovação. Os bancos em Portugal costumam exigir estabilidade profissional demonstrável.',
    };
  }
  if (capitalOk === 'NAO') {
    return {
      key: 'inviavel',
      comment: 'Sem viabilidade (não reside em PT, sem 20% entrada)',
      body: 'Resultado inviável:\n❌ Como regra, para investidores estrangeiros os bancos em Portugal financiam em muitos casos cerca de 80% do valor do imóvel — ou seja, é habitual precisar de cerca de 20% em capitais próprios. Sem essa entrada, fica muito difícil avançar.',
    };
  }
  return {
    key: 'foreign-80',
    comment: 'Possível viabilidade ~80% (não reside em PT)',
    body: 'Resultado (investidor estrangeiro):\n✅ Em termos gerais, com contrato de trabalho efetivo e cerca de 20% em capitais próprios para entrada, o seu caso alinha-se com o que muitos bancos em Portugal costumam pedir (financiamento na ordem dos 80% do valor do imóvel). Não é garantia de aprovação — vale confirmar com um gestor de crédito.',
  };
}

/** Classifica em função da árvore completa (a partir de answers serializadas). */
export function classifyAnswers(
  answers: FinancingQuizAnswers,
): FinancingOutcome {
  if (resolveTrack(answers.residencePt) === 'foreign') {
    return classifyForeignInvestorAnswers(
      answers.foreignCtef,
      answers.foreignCapital,
    );
  }
  // Trilha residente: garantir capitalOk quando aplicável (consistência com receiver).
  const q5 = answers.q5;
  let capitalOk = answers.capitalOk;
  // q7 só existe quando q3=NAO.
  if (answers.q3 === 'SIM') {
    const requiredPct = computeRequiredCapitalPercent(
      answers.q2,
      answers.q3,
      q5,
    );
    if (requiredPct !== null && capitalOk === undefined) {
      // O caller não enviou capitalOk para um caso que o exige — tratamos como inviável.
      capitalOk = 'NAO';
    }
    if (capitalOk === 'NAO' && requiredPct !== null) {
      return {
        key: 'inviavel',
        comment: 'Sem viabilidade (sem capitais próprios para entrada)',
        body: `Resultado inviável:\n❌ Sem cerca de ${requiredPct}% do valor do imóvel em capitais próprios para dar de entrada, é muito difícil avançar com o crédito habitação.`,
      };
    }
  }
  return classifyFinancingAnswers(answers.q2, answers.q3, q5, answers.q7);
}

// ===== Exemplos práticos =====

export const FINANCING_EXAMPLE_100_PCT = `Exemplo prático (ilustrativo)

Casa: 200 000 €
Financiamento: 100%
Prazo: 35 anos
Prestação com seguros: 750 €

Custos no dia da escritura:
• Imposto sobre o crédito: 1 200 €
• Escritura: 1 000 €`;

export const FINANCING_EXAMPLE_90_PCT = `Exemplo prático (ilustrativo)

Casa: 200 000 €
Financiamento: 90%
Prazo: 35 anos
Prestação com seguros: 723 €

Custos no dia da escritura:
• Entrada: 20 000 €
• IMT: 3 540 €
• Imposto sobre o crédito: 1 100 €
• Imposto sobre a compra: 1 600 €
• Escritura: 1 000 €`;

export function financingPracticalExampleForOutcome(
  key: FinancingOutcomeKey,
): { intro?: string; body: string } | null {
  switch (key) {
    case '100':
      return { body: FINANCING_EXAMPLE_100_PCT };
    case '90':
      return { body: FINANCING_EXAMPLE_90_PCT };
    case '80':
    case 'foreign-80':
      return {
        intro:
          'Para o seu perfil (financiamento na ordem dos 80%, entrada ~20%), segue um exemplo ilustrativo com a mesma casa de referência — valores finais dependem do banco e da simulação:',
        body: FINANCING_EXAMPLE_90_PCT,
      };
    case 'indef-sem-ctef-10':
    case 'fallback':
      return {
        intro:
          'Segue um exemplo ilustrativo com entrada e custos na escritura (valores indicativos):',
        body: FINANCING_EXAMPLE_90_PCT,
      };
    case 'inviavel':
    default:
      return null;
  }
}

/** Apenas outcomes não inviáveis podem solicitar atendimento da gestora. */
export function outcomeIsEligibleForAtendimento(
  key: FinancingOutcomeKey,
): boolean {
  return key !== 'inviavel';
}
