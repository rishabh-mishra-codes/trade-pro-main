# ---- build stage ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -q -B dependency:go-offline
COPY src src
RUN ./mvnw -q -B -DskipTests package

# ---- run stage ----
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
ENV JAVA_TOOL_OPTIONS="-Xmx400m -XX:+UseSerialGC"
EXPOSE 8080
# server.port=${PORT:8080} is already set in application.properties; Render injects PORT.
ENTRYPOINT ["java", "-jar", "app.jar"]
