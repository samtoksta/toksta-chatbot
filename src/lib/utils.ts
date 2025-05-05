import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Calculates the cosine similarity between two vectors.
 * Assumes vectors are non-empty and have the same length.
 * @param vecA - The first vector (array of numbers).
 * @param vecB - The second vector (array of numbers).
 * @returns The cosine similarity score (between -1 and 1).
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
        console.error('Invalid vectors for cosine similarity calculation.');
        return 0; // Or throw an error, depending on desired handling
    }

    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const magnitudeA = Math.sqrt(normA);
    const magnitudeB = Math.sqrt(normB);

    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0; // Avoid division by zero if one vector is all zeros
    }

    return dotProduct / (magnitudeA * magnitudeB);
}
