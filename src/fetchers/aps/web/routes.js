export function getApsRoutes(journalConfig, status, page = 1) {
  if (status === "accepted") {
    return {
      listUrl: `${journalConfig.baseUrl}/accepted-papers?page=${page}`,
      detailBaseUrl: `${journalConfig.baseUrl}/accepted/`
    };
  }

  return {
    listUrl: `${journalConfig.baseUrl}/recent?page=${page}`,
    detailBaseUrl: `${journalConfig.baseUrl}/abstract/`
  };
}
