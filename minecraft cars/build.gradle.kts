plugins {
    java
}

group = "ru.customvehicles"
version = "1.2.1"

val materialGeneratorSourceSet = sourceSets.create("materialGenerator") {
    java.srcDir("src/materialGenerator/java")
    compileClasspath += sourceSets.main.get().compileClasspath
    runtimeClasspath += output + compileClasspath
}

repositories {
    mavenCentral()
    maven {
        name = "papermc"
        url = uri("https://repo.papermc.io/repository/maven-public/")
    }
    maven {
        name = "dmulloy2"
        url = uri("https://repo.dmulloy2.net/repository/public/")
    }
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.1-R0.1-SNAPSHOT")
    compileOnly("com.comphenix.protocol:ProtocolLib:5.3.0")

    testImplementation(platform("org.junit:junit-bom:5.14.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("io.papermc.paper:paper-api:1.21.1-R0.1-SNAPSHOT")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release = 21
}

tasks.processResources {
    filteringCharset = "UTF-8"
    val resourceProperties = mapOf("version" to project.version)
    inputs.properties(resourceProperties)
    filesMatching("plugin.yml") {
        expand(resourceProperties)
    }
}

tasks.test {
    useJUnitPlatform()
}

tasks.jar {
    archiveBaseName = "CustomVehicles"
}

tasks.register<JavaExec>("generateBlockMaterials") {
    group = "generation"
    description = "Generates the editor's Paper 1.21.1 block Material catalog"
    dependsOn(tasks.named(materialGeneratorSourceSet.compileJavaTaskName))
    classpath = materialGeneratorSourceSet.runtimeClasspath
    mainClass = "ru.customvehicles.tools.BlockMaterialJsonGenerator"
    args(
        layout.projectDirectory
            .dir("../custom_vehicles_editor/src/shared")
            .file("block-materials.json")
            .asFile
            .absolutePath
    )
}
