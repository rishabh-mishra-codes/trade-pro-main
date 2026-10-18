package com.tradepro.trade;

import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;

import com.tradepro.auth.dto.UserResponse;

import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Service
public class OrderHistoryPdfService {

    // Dates are rendered against a fixed zone so the PDF is deterministic regardless of server TZ.
    private static final DateTimeFormatter DATE_FMT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Kolkata"));

    private static final String[] HEADERS = {"Date", "Symbol", "Side", "Qty", "Price", "Status"};

    // Rupee formatting matching the frontend fmt(): "₹" + en-IN grouping + 2 decimals.
    static String rupee(double v) {
        return "\u20b9" + String.format(Locale.forLanguageTag("en-IN"), "%,.2f", v);
    }

    // Row model exposed for testing: {date, symbol, side, qty, price, status} per order.
    static List<String[]> toRows(List<OrderRecord> orders) {
        List<String[]> rows = new ArrayList<>();
        if (orders == null) {
            return rows;
        }
        for (OrderRecord o : orders) {
            String date = o.getCreatedAt() == null ? "" : DATE_FMT.format(o.getCreatedAt());
            String symbol = o.getSymbol() == null ? "" : o.getSymbol();
            String side = o.getSide() == null ? "" : o.getSide().name();
            String qty = Integer.toString(o.getQuantity());
            String price = rupee(o.getPrice());
            String status = o.getStatus() == null ? "" : o.getStatus().name();
            rows.add(new String[] {date, symbol, side, qty, price, status});
        }
        return rows;
    }

    // Builds a PDF of the user's orders. Never throws for an empty (or null) list.
    public byte[] build(UserResponse user, List<OrderRecord> orders) {
        Document document = new Document(PageSize.A4, 36, 36, 48, 36);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        PdfWriter.getInstance(document, out);
        document.open();
        try {
            Font titleFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 18);
            Paragraph title = new Paragraph("TradePro Order History", titleFont);
            document.add(title);

            String name = user != null && user.getFullName() != null ? user.getFullName() : "";
            String email = user != null && user.getEmail() != null ? user.getEmail() : "";
            Font subFont = FontFactory.getFont(FontFactory.HELVETICA, 11);
            Paragraph who = new Paragraph(name + (email.isEmpty() ? "" : " (" + email + ")"), subFont);
            who.setSpacingAfter(12f);
            document.add(who);

            List<String[]> rows = toRows(orders);
            if (rows.isEmpty()) {
                document.add(new Paragraph("No orders to display.", subFont));
            } else {
                PdfPTable table = new PdfPTable(HEADERS.length);
                table.setWidthPercentage(100f);

                Font headerFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 10);
                for (String header : HEADERS) {
                    PdfPCell cell = new PdfPCell(new Phrase(header, headerFont));
                    cell.setHorizontalAlignment(Element.ALIGN_LEFT);
                    cell.setPadding(5f);
                    table.addCell(cell);
                }
                table.setHeaderRows(1);

                Font cellFont = FontFactory.getFont(FontFactory.HELVETICA, 10);
                for (String[] row : rows) {
                    for (String value : row) {
                        PdfPCell cell = new PdfPCell(new Phrase(value, cellFont));
                        cell.setPadding(4f);
                        table.addCell(cell);
                    }
                }
                document.add(table);
            }
        } finally {
            document.close();
        }
        return out.toByteArray();
    }
}
