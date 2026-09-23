import { Product } from "./types";
import { fetchProductsFromSheet } from "./googleSheets";

export async function parseProducts(): Promise<Product[]> {
  return fetchProductsFromSheet();
}
