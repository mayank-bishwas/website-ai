const contactPatterns = [
  /\b(contact|talk to|speak to|human|person|support|customer service|problem with (?:the )?(?:assistant|website)|issue with (?:the )?(?:assistant|website)|help with (?:the )?(?:assistant|website))\b/i,
  /संपर्क|बात करें|किसी व्यक्ति|इंसान|सहायता|मदद चाहिए|वेबसाइट सहायक में समस्या|सहायक में दिक्कत/i,
];

export function isContactRequest(question: string): boolean {
  return contactPatterns.some((pattern) => pattern.test(question));
}

export type AskLanguage = "en" | "hi" | "ar" | "bn" | "gu" | "zh" | "ja" | "ko" | "es" | "fr" | "de" | "pt";

export function detectAskLanguage(question: string): AskLanguage {
  if (/[\u0900-\u097f]/u.test(question)) return "hi";
  if (/[\u0600-\u06ff]/u.test(question)) return "ar";
  if (/[\u0980-\u09ff]/u.test(question)) return "bn";
  if (/[\u0a80-\u0aff]/u.test(question)) return "gu";
  if (/[\u3040-\u30ff]/u.test(question)) return "ja";
  if (/[\u4e00-\u9fff]/u.test(question)) return "zh";
  if (/[\uac00-\ud7af]/u.test(question)) return "ko";
  if (/\b(hola|producto|precio|disponible|tienda|ayuda|problema|gracias|qué|cuál)\b/i.test(question)) return "es";
  if (/\b(bonjour|produit|prix|disponible|magasin|aide|problème|merci|quel|quelle)\b/i.test(question)) return "fr";
  if (/\b(hallo|produkt|preis|verfügbar|laden|hilfe|problem|danke|welche)\b/i.test(question)) return "de";
  if (/\b(olá|produto|preço|disponível|loja|ajuda|problema|obrigado|qual)\b/i.test(question)) return "pt";
  return "en";
}
